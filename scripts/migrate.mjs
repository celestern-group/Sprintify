// Deploy-time migration runner.
//
// Deliberately plain .mjs, not TypeScript: it has to run inside the production
// image, where `tsx` and `drizzle-kit` are devDependencies that a prune step
// may have removed. `drizzle-orm` and `pg` are runtime dependencies, so this
// keeps working no matter how the image is built.
//
// It reads the same ./drizzle folder and the same drizzle.__drizzle_migrations
// bookkeeping table as `pnpm db:migrate`, so applying migrations here and
// locally cannot diverge.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });

const MAX_SPRINT_DAYS = 366;

function isoDate(value) {
  return String(value).slice(0, 10);
}

function addDaysIso(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function isoWeekday(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * One-time, retry-safe reconciliation for the migration that introduced
 * `capacityLastSyncedAt`. Normal application writes take over after this
 * marks a sprint synced; this exists so an already-stale row is fixed on the
 * rollout that adds the automatic profile propagation.
 */
async function backfillOpenSprintCapacities() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`
      SELECT
        smc.id AS capacity_id,
        smc."memberId" AS member_id,
        smc."availabilityPercent" AS availability_percent,
        smc."plannedPoints" AS planned_points,
        smc."isOverridden" AS is_overridden,
        s.id AS sprint_id,
        s."startDate"::text AS start_date,
        s."endDate"::text AS end_date,
        s."workingWeekdays" AS sprint_weekdays,
        p."defaultHoursPerDay" AS default_hours_per_day,
        p."holidayCalendarId" AS project_calendar_id,
        profile."hoursPerDay" AS profile_hours_per_day,
        profile."workingWeekdays" AS profile_weekdays,
        profile."holidayCalendarId" AS profile_calendar_id,
        org_calendar.id AS org_calendar_id
      FROM "sprintMemberCapacity" smc
      INNER JOIN sprint s ON s.id = smc."sprintId"
      INNER JOIN project p ON p.id = s."projectId"
      LEFT JOIN "memberCapacityProfile" profile ON profile."memberId" = smc."memberId"
      LEFT JOIN LATERAL (
        SELECT id
        FROM "holidayCalendar"
        WHERE "organizationId" = p."organizationId" AND "isDefault" = true
        LIMIT 1
      ) org_calendar ON true
      WHERE s.state <> 'completed' AND s."capacityLastSyncedAt" IS NULL
      FOR UPDATE OF smc, s
    `);

    if (rows.length === 0) {
      await client.query("COMMIT");
      return 0;
    }

    const sprintIds = [...new Set(rows.map((row) => row.sprint_id))];
    const memberIds = [...new Set(rows.map((row) => row.member_id))];
    const starts = rows.map((row) => isoDate(row.start_date));
    const ends = rows.map((row) => isoDate(row.end_date));
    const start = starts.sort()[0];
    const end = ends.sort().at(-1);
    const calendarIds = [
      ...new Set(
        rows
          .map(
            (row) =>
              row.profile_calendar_id ??
              row.project_calendar_id ??
              row.org_calendar_id,
          )
          .filter(Boolean),
      ),
    ];

    const { rows: holidays } =
      calendarIds.length === 0
        ? { rows: [] }
        : await client.query(
            `SELECT "calendarId" AS calendar_id, date::text AS date
             FROM holiday
             WHERE "calendarId" = ANY($1) AND date >= $2 AND date <= $3`,
            [calendarIds, start, end],
          );
    const { rows: leaves } = await client.query(
      `SELECT "memberId" AS member_id, "startDate"::text AS start_date,
              "endDate"::text AS end_date, portion
       FROM "memberLeave"
       WHERE "memberId" = ANY($1) AND status <> 'cancelled'
         AND "startDate" <= $2 AND "endDate" >= $3`,
      [memberIds, end, start],
    );

    const holidaysByCalendar = new Map();
    for (const holiday of holidays) {
      const dates = holidaysByCalendar.get(holiday.calendar_id) ?? new Set();
      dates.add(isoDate(holiday.date));
      holidaysByCalendar.set(holiday.calendar_id, dates);
    }
    const leavesByMember = new Map();
    for (const leave of leaves) {
      const memberLeaves = leavesByMember.get(leave.member_id) ?? [];
      memberLeaves.push({
        startDate: isoDate(leave.start_date),
        endDate: isoDate(leave.end_date),
        portion: Number(leave.portion),
      });
      leavesByMember.set(leave.member_id, memberLeaves);
    }

    for (const row of rows) {
      const sprintStart = isoDate(row.start_date);
      const sprintEnd = isoDate(row.end_date);
      const sprintDays = new Set(row.sprint_weekdays);
      const workingWeekdays = (
        row.profile_weekdays ?? row.sprint_weekdays
      ).filter((day) => sprintDays.has(day));
      const calendarId =
        row.profile_calendar_id ??
        row.project_calendar_id ??
        row.org_calendar_id;
      const holidaysForRow = holidaysByCalendar.get(calendarId) ?? new Set();
      const leavesForRow = leavesByMember.get(row.member_id) ?? [];
      let workingDays = 0;
      let holidayDays = 0;
      const leaveByDay = new Map();

      for (let offset = 0; offset <= MAX_SPRINT_DAYS; offset += 1) {
        const day = addDaysIso(sprintStart, offset);
        if (workingWeekdays.includes(isoWeekday(day))) {
          workingDays += 1;
          if (holidaysForRow.has(day)) {
            holidayDays += 1;
          } else {
            for (const leave of leavesForRow) {
              if (leave.startDate <= day && day <= leave.endDate) {
                leaveByDay.set(
                  day,
                  Math.max(leaveByDay.get(day) ?? 0, leave.portion),
                );
              }
            }
          }
        }
        if (day === sprintEnd) break;
      }

      const leaveDays = round2(
        [...leaveByDay.values()].reduce((total, portion) => total + portion, 0),
      );
      const effectiveDays = round2(
        Math.max(0, workingDays - holidayDays - leaveDays) *
          (Math.min(100, Math.max(0, Number(row.availability_percent))) / 100),
      );

      if (row.is_overridden) {
        await client.query(
          `UPDATE "sprintMemberCapacity"
           SET "workingDays" = $1, "holidayDays" = $2, "leaveDays" = $3
           WHERE id = $4`,
          [workingDays, holidayDays, leaveDays, row.capacity_id],
        );
        continue;
      }

      const hoursPerDay = Number(
        row.profile_hours_per_day ?? row.default_hours_per_day,
      );
      const plannedHours = round2(effectiveDays * Math.max(0, hoursPerDay));
      const plannedPoints =
        workingDays > 0
          ? round2((Number(row.planned_points) * effectiveDays) / workingDays)
          : 0;
      await client.query(
        `UPDATE "sprintMemberCapacity"
         SET "hoursPerDay" = $1, "hoursPerDayPinned" = false,
             "workingDays" = $2, "holidayDays" = $3, "leaveDays" = $4,
             "plannedHours" = $5, "plannedPoints" = $6
         WHERE id = $7`,
        [
          hoursPerDay,
          workingDays,
          holidayDays,
          leaveDays,
          plannedHours,
          plannedPoints,
          row.capacity_id,
        ],
      );
    }

    await client.query(
      `UPDATE sprint s
       SET "plannedCapacity" = COALESCE((
             SELECT SUM(CASE WHEN s."capacityUnit" = 'points'
               THEN smc."plannedPoints" ELSE smc."plannedHours" END)
             FROM "sprintMemberCapacity" smc
             WHERE smc."sprintId" = s.id
           ), 0),
           "capacityLastSyncedAt" = NOW()
       WHERE s.id = ANY($1)`,
      [sprintIds],
    );
    await client.query("COMMIT");
    return sprintIds.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  const backfilled = await backfillOpenSprintCapacities();
  if (backfilled > 0) {
    console.log(
      `[migrate] reconciled capacity for ${backfilled} open sprint(s)`,
    );
  }
  console.log("[migrate] up to date");
} catch (error) {
  console.error("[migrate] failed", error);
  process.exit(1);
} finally {
  await pool.end();
}
