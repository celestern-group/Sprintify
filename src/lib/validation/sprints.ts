import { z } from "zod";
import { CAPACITY_UNITS } from "@/db/schema/sprints";
import {
  hoursPerDaySchema,
  idSchema,
  isoDateSchema,
  timezoneSchema,
  workingWeekdaysSchema,
} from "@/lib/validation/common";

// Input schemas for the sprint and capacity server actions.

export const sprintNameSchema = z.string().trim().min(1).max(120);
export const sprintGoalSchema = z.string().trim().max(2000).optional();

// A sprint longer than a quarter is a project, not a sprint; the cap also
// bounds how much date arithmetic a single request can trigger.
const MAX_SPRINT_DAYS = 92;

const sprintRange = z
  .object({ startDate: isoDateSchema, endDate: isoDateSchema })
  .refine((value) => value.startDate <= value.endDate, {
    message: "A sprint can't end before it starts.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      (Date.parse(`${value.endDate}T00:00:00Z`) -
        Date.parse(`${value.startDate}T00:00:00Z`)) /
        86_400_000 <
      MAX_SPRINT_DAYS,
    { message: "A sprint can't be longer than 92 days.", path: ["endDate"] },
  );

export const createSprintSchema = z
  .object({
    projectId: idSchema,
    // Optional: defaults to "Sprint <n>" from the project's sequence.
    name: sprintNameSchema.optional(),
    goal: sprintGoalSchema,
  })
  .and(sprintRange);

export const updateSprintSchema = z
  .object({
    sprintId: idSchema,
    name: sprintNameSchema,
    goal: sprintGoalSchema,
  })
  .and(sprintRange);

export const sprintIdSchema = z.object({ sprintId: idSchema });

export const completeSprintSchema = z.object({
  sprintId: idSchema,
  completedPoints: z.number().min(0).max(100_000).optional(),
});

/** Dragging a bar on the timeline only ever moves dates. */
export const moveSprintSchema = z
  .object({ sprintId: idSchema })
  .and(sprintRange);

export const setMemberCapacitySchema = z.object({
  sprintId: idSchema,
  memberId: idSchema,
  availabilityPercent: z.number().int().min(0).max(100),
  hoursPerDay: hoursPerDaySchema,
  /** Present only in points mode — the per-sprint baseline to prorate. */
  plannedPoints: z.number().min(0).max(10_000).optional(),
  /** Pins the number against recomputes triggered by leave or holidays. */
  isOverridden: z.boolean().default(false),
  overrideReason: z.string().trim().max(280).optional(),
  /** Hours to pin when isOverridden is true. Ignored otherwise. */
  plannedHours: z.number().min(0).max(10_000).optional(),
});

export const resetMemberCapacitySchema = z.object({
  sprintId: idSchema,
  memberId: idSchema,
});

export const projectCadenceSchema = z.object({
  projectId: idSchema,
  capacityUnit: z.enum(CAPACITY_UNITS),
  sprintLengthDays: z.number().int().min(1).max(90),
  defaultHoursPerDay: hoursPerDaySchema,
  workingWeekdays: workingWeekdaysSchema,
  timezone: timezoneSchema,
  holidayCalendarId: idSchema.nullable().optional(),
});
