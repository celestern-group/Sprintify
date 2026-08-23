import { z } from "zod";
import { LEAVE_STATUSES, LEAVE_TYPES } from "@/db/schema/calendar";
import {
  hoursPerDaySchema,
  idSchema,
  isoDateSchema,
  workingWeekdaysSchema,
} from "@/lib/validation/common";

// Input schemas for the availability server actions (src/lib/actions/leave.ts).

export const leaveTypeSchema = z.enum(LEAVE_TYPES);
export const leaveStatusSchema = z.enum(LEAVE_STATUSES);

// Whole or half days. A finer grain would need per-day rows rather than a
// range, which is not worth it until someone asks for it.
export const portionSchema = z.union([z.literal(1), z.literal(0.5)]);

// Bounds the recompute fan-out: a range is at most a year, so a typo like
// "2026" vs "2126" can't schedule a hundred years of sprint recalculation.
const MAX_LEAVE_DAYS = 366;

const dateRange = z
  .object({ startDate: isoDateSchema, endDate: isoDateSchema })
  .refine((value) => value.startDate <= value.endDate, {
    message: "The end date can't be before the start date.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      (Date.parse(`${value.endDate}T00:00:00Z`) -
        Date.parse(`${value.startDate}T00:00:00Z`)) /
        86_400_000 <
      MAX_LEAVE_DAYS,
    { message: "Leave can't span more than a year.", path: ["endDate"] },
  );

export const createLeaveSchema = z
  .object({
    organizationId: idSchema,
    // Omitted means "me" — the common case, and the one that needs no
    // permission. Naming someone else requires capacity:manage or member
    // administration, checked in the action.
    memberId: idSchema.optional(),
    portion: portionSchema.default(1),
    type: leaveTypeSchema.default("vacation"),
    status: leaveStatusSchema.default("planned"),
    note: z.string().trim().max(500).optional(),
  })
  .and(dateRange);

export const updateLeaveSchema = z
  .object({
    leaveId: idSchema,
    portion: portionSchema,
    type: leaveTypeSchema,
    status: leaveStatusSchema,
    note: z.string().trim().max(500).optional(),
  })
  .and(dateRange);

export const leaveIdSchema = z.object({ leaveId: idSchema });

export const listLeaveSchema = z.object({
  organizationId: idSchema,
  memberId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const capacityProfileSchema = z.object({
  organizationId: idSchema,
  memberId: idSchema.optional(),
  hoursPerDay: hoursPerDaySchema,
  workingWeekdays: workingWeekdaysSchema,
  holidayCalendarId: idSchema.nullable().optional(),
});
