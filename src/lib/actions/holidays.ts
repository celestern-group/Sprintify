"use server";

import { and, asc, count, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { holiday, holidayCalendar, project } from "@/db/schema";
import {
  embeddingSource,
  scheduleEmbedding,
  scheduleEmbeddings,
} from "@/lib/ai/embeddings";
import { recordAudit } from "@/lib/audit";
import { ensureOrganizationDefaultCalendar } from "@/lib/calendar-seed";
import { recomputeSprintsInWindow } from "@/lib/capacity-sync";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import {
  findCallerMembership,
  hasOrgPermission,
  isUniqueViolation,
} from "@/lib/project-access";
import { requireAuth } from "@/lib/session";
import {
  addHolidaysSchema,
  calendarIdSchema,
  createCalendarSchema,
  removeHolidaySchema,
  updateCalendarSchema,
} from "@/lib/validation/calendar";

function revalidateCalendars() {
  revalidatePath("/manage-org/[slug]/working-time", "page");
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

// Calendars are org-level: one serves many projects, so managing them is an
// owner/admin concern rather than a per-project one. A member's own leave is
// governed separately (src/lib/actions/leave.ts) and needs no permission.
async function requireCalendarPermission(
  organizationId: string,
  action: "create" | "update" | "delete",
) {
  const session = await requireAuth();
  const allowed = await hasOrgPermission(organizationId, {
    holidayCalendar: [action],
  });
  if (!allowed) {
    throw new Error(
      `You don't have permission to ${action} working-time calendars.`,
    );
  }
  return session;
}

// Derive the org from the stored row so a forged calendarId can't be paired
// with an organizationId the caller does have rights on.
async function loadCalendarOrThrow(calendarId: string) {
  const [row] = await db
    .select({
      id: holidayCalendar.id,
      organizationId: holidayCalendar.organizationId,
      name: holidayCalendar.name,
      isDefault: holidayCalendar.isDefault,
      timezone: holidayCalendar.timezone,
      source: holidayCalendar.source,
    })
    .from(holidayCalendar)
    .where(eq(holidayCalendar.id, calendarId))
    .limit(1);
  if (!row) throw new Error("Calendar not found.");
  return row;
}

export type CalendarSummary = {
  id: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  source: "local" | "sap";
  holidayCount: number;
  projectCount: number;
};

export async function getCalendars(
  organizationId: string,
): Promise<CalendarSummary[]> {
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }

  await ensureOrganizationDefaultCalendar(organizationId);

  const calendars = await db
    .select({
      id: holidayCalendar.id,
      name: holidayCalendar.name,
      timezone: holidayCalendar.timezone,
      isDefault: holidayCalendar.isDefault,
      source: holidayCalendar.source,
    })
    .from(holidayCalendar)
    .where(eq(holidayCalendar.organizationId, organizationId))
    .orderBy(holidayCalendar.name);

  if (calendars.length === 0) return [];
  const ids = calendars.map((row) => row.id);

  const [holidayCounts, projectCounts] = await Promise.all([
    db
      .select({ calendarId: holiday.calendarId, value: count() })
      .from(holiday)
      .where(inArray(holiday.calendarId, ids))
      .groupBy(holiday.calendarId),
    db
      .select({ calendarId: project.holidayCalendarId, value: count() })
      .from(project)
      .where(inArray(project.holidayCalendarId, ids))
      .groupBy(project.holidayCalendarId),
  ]);

  const holidaysBy = new Map(holidayCounts.map((r) => [r.calendarId, r.value]));
  const projectsBy = new Map(projectCounts.map((r) => [r.calendarId, r.value]));

  return calendars.map((row) => ({
    ...row,
    holidayCount: holidaysBy.get(row.id) ?? 0,
    projectCount: projectsBy.get(row.id) ?? 0,
  }));
}

export type HolidayRow = { id: string; date: string; name: string };

/** One calendar's dates, optionally narrowed to a year for the year picker. */
export async function getHolidays(input: {
  calendarId: string;
  year?: number;
}): Promise<HolidayRow[]> {
  const session = await requireAuth();
  const calendar = await loadCalendarOrThrow(input.calendarId);
  const membership = await findCallerMembership(
    session.user.id,
    calendar.organizationId,
  );
  if (!membership) {
    throw new Error("You don't have access to this organization.");
  }

  const where = input.year
    ? and(
        eq(holiday.calendarId, input.calendarId),
        gte(holiday.date, `${input.year}-01-01`),
        lte(holiday.date, `${input.year}-12-31`),
      )
    : eq(holiday.calendarId, input.calendarId);

  return db
    .select({ id: holiday.id, date: holiday.date, name: holiday.name })
    .from(holiday)
    .where(where)
    .orderBy(asc(holiday.date));
}

export async function createCalendar(input: {
  organizationId: string;
  name: string;
  timezone?: string;
  isDefault?: boolean;
}) {
  const parsed = createCalendarSchema.parse(input);
  const session = await requireCalendarPermission(
    parsed.organizationId,
    "create",
  );
  await assertPlatformNotLocked();

  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      if (parsed.isDefault) {
        // The partial unique index allows exactly one default per org, so the
        // old one has to be cleared in the same transaction.
        await tx
          .update(holidayCalendar)
          .set({ isDefault: false })
          .where(
            and(
              eq(holidayCalendar.organizationId, parsed.organizationId),
              eq(holidayCalendar.isDefault, true),
            ),
          );
      }
      await tx.insert(holidayCalendar).values({
        id,
        organizationId: parsed.organizationId,
        name: parsed.name,
        timezone: parsed.timezone,
        isDefault: parsed.isDefault,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A calendar with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    action: "holidayCalendar.created",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: id,
    metadata: {
      name: parsed.name,
      timezone: parsed.timezone,
      isDefault: parsed.isDefault,
    },
  });

  scheduleEmbedding({
    organizationId: parsed.organizationId,
    text: embeddingSource(parsed.name),
    persist: async (result) => {
      await db
        .update(holidayCalendar)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(holidayCalendar.id, id));
    },
  });

  revalidateCalendars();
  return id;
}

export async function updateCalendar(input: {
  calendarId: string;
  name: string;
  timezone: string;
}) {
  const parsed = updateCalendarSchema.parse(input);
  const existing = await loadCalendarOrThrow(parsed.calendarId);
  const session = await requireCalendarPermission(
    existing.organizationId,
    "update",
  );

  try {
    await db
      .update(holidayCalendar)
      .set({ name: parsed.name, timezone: parsed.timezone })
      .where(eq(holidayCalendar.id, parsed.calendarId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A calendar with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    action: "holidayCalendar.updated",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: parsed.calendarId,
    metadata: { name: parsed.name, timezone: parsed.timezone },
  });

  scheduleEmbedding({
    organizationId: existing.organizationId,
    text: embeddingSource(parsed.name),
    persist: async (result) => {
      await db
        .update(holidayCalendar)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(eq(holidayCalendar.id, parsed.calendarId));
    },
  });

  revalidateCalendars();
}

export async function setDefaultCalendar(input: { calendarId: string }) {
  const parsed = calendarIdSchema.parse(input);
  const existing = await loadCalendarOrThrow(parsed.calendarId);
  const session = await requireCalendarPermission(
    existing.organizationId,
    "update",
  );

  await db.transaction(async (tx) => {
    await tx
      .update(holidayCalendar)
      .set({ isDefault: false })
      .where(
        and(
          eq(holidayCalendar.organizationId, existing.organizationId),
          eq(holidayCalendar.isDefault, true),
        ),
      );
    await tx
      .update(holidayCalendar)
      .set({ isDefault: true })
      .where(eq(holidayCalendar.id, parsed.calendarId));
  });

  await recordAudit({
    action: "holidayCalendar.default_set",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: parsed.calendarId,
    metadata: { name: existing.name },
  });
  revalidateCalendars();
}

export async function deleteCalendar(input: { calendarId: string }) {
  const parsed = calendarIdSchema.parse(input);
  const existing = await loadCalendarOrThrow(parsed.calendarId);
  const session = await requireCalendarPermission(
    existing.organizationId,
    "delete",
  );

  // Deleting the default would leave projects that inherit it with no calendar
  // at all, and nothing to fall back to. Make another one default first.
  if (existing.isDefault) {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(holidayCalendar)
      .where(eq(holidayCalendar.organizationId, existing.organizationId));
    if (total > 1) {
      throw new Error(
        "Make another calendar the default before deleting this one.",
      );
    }
  }

  await db
    .delete(holidayCalendar)
    .where(eq(holidayCalendar.id, parsed.calendarId));

  await recordAudit({
    action: "holidayCalendar.deleted",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: parsed.calendarId,
    metadata: { name: existing.name },
  });
  revalidateCalendars();
}

export async function addHolidays(input: {
  calendarId: string;
  holidays: { date: string; name: string }[];
}) {
  const parsed = addHolidaysSchema.parse(input);
  const existing = await loadCalendarOrThrow(parsed.calendarId);
  const session = await requireCalendarPermission(
    existing.organizationId,
    "update",
  );

  // Re-adding a date someone already has is a no-op, not an error: half the
  // point of the paste box is re-importing a list that partly overlaps.
  // `returning` therefore yields only the rows that were actually inserted —
  // which is exactly the set that still needs an embedding.
  const inserted = await db
    .insert(holiday)
    .values(
      parsed.holidays.map((row) => ({
        calendarId: parsed.calendarId,
        date: row.date,
        name: row.name,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: holiday.id, name: holiday.name });

  const dates = parsed.holidays.map((row) => row.date).sort();

  await recordAudit({
    action: "holiday.added",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: parsed.calendarId,
    metadata: {
      calendar: existing.name,
      count: parsed.holidays.length,
      from: dates[0],
      to: dates.at(-1),
    },
  });

  scheduleEmbeddings({
    organizationId: existing.organizationId,
    items: inserted.map((row) => ({
      id: row.id,
      text: embeddingSource(row.name),
    })),
    persist: async (result, ids) => {
      await db
        .update(holiday)
        .set({
          embedding: result.embedding,
          embeddingModel: result.model,
          embeddingUpdatedAt: new Date(),
        })
        .where(inArray(holiday.id, ids));
    },
  });

  // Non-working days moved, so every in-flight sprint that spans them is now
  // planned against the wrong number.
  await recomputeSprintsInWindow({
    organizationId: existing.organizationId,
    start: dates[0],
    end: dates.at(-1) ?? dates[0],
  });

  revalidateCalendars();
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

export async function removeHoliday(input: {
  calendarId: string;
  holidayId: string;
}) {
  const parsed = removeHolidaySchema.parse(input);
  const existing = await loadCalendarOrThrow(parsed.calendarId);
  const session = await requireCalendarPermission(
    existing.organizationId,
    "update",
  );

  const [row] = await db
    .select({ date: holiday.date, name: holiday.name })
    .from(holiday)
    .where(
      and(
        eq(holiday.id, parsed.holidayId),
        eq(holiday.calendarId, parsed.calendarId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Holiday not found.");

  await db.delete(holiday).where(eq(holiday.id, parsed.holidayId));

  await recordAudit({
    action: "holiday.removed",
    organizationId: existing.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "holidayCalendar",
    targetId: parsed.calendarId,
    metadata: { calendar: existing.name, date: row.date, name: row.name },
  });

  await recomputeSprintsInWindow({
    organizationId: existing.organizationId,
    start: row.date,
    end: row.date,
  });

  revalidateCalendars();
  revalidatePath("/app/[orgSlug]/[projectKey]/sprints", "page");
}

/** Points a project at a calendar (or back at the org default when null). */
export async function setProjectCalendar(input: {
  projectId: string;
  calendarId: string | null;
}) {
  const parsed = z
    .object({
      projectId: z.string().min(1),
      calendarId: z.string().min(1).nullable(),
    })
    .parse(input);

  const [projectRow] = await db
    .select({
      id: project.id,
      name: project.name,
      organizationId: project.organizationId,
    })
    .from(project)
    .where(eq(project.id, parsed.projectId))
    .limit(1);
  if (!projectRow) throw new Error("Project not found.");

  const session = await requireCalendarPermission(
    projectRow.organizationId,
    "update",
  );

  if (parsed.calendarId) {
    const calendar = await loadCalendarOrThrow(parsed.calendarId);
    if (calendar.organizationId !== projectRow.organizationId) {
      throw new Error("That calendar belongs to another organization.");
    }
  }

  await db
    .update(project)
    .set({ holidayCalendarId: parsed.calendarId })
    .where(eq(project.id, parsed.projectId));

  await recordAudit({
    action: "project.calendar_set",
    organizationId: projectRow.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "project",
    targetId: parsed.projectId,
    metadata: { calendarId: parsed.calendarId },
  });
  revalidateCalendars();
}
