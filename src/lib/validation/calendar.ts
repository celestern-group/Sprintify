import { z } from "zod";
import {
  idSchema,
  isoDateSchema,
  timezoneSchema,
} from "@/lib/validation/common";

// Input schemas for the holiday-calendar server actions
// (src/lib/actions/holidays.ts).

export const calendarNameSchema = z.string().trim().min(1).max(120);
export const holidayNameSchema = z.string().trim().min(1).max(160);

export const createCalendarSchema = z.object({
  organizationId: idSchema,
  name: calendarNameSchema,
  timezone: timezoneSchema.default("UTC"),
  isDefault: z.boolean().default(false),
});

export const updateCalendarSchema = z.object({
  calendarId: idSchema,
  name: calendarNameSchema,
  timezone: timezoneSchema,
});

export const calendarIdSchema = z.object({ calendarId: idSchema });

// Bulk by design: an admin pastes a year of public holidays in one go, and one
// round trip per date would be both slow and a partial-failure hazard.
export const addHolidaysSchema = z.object({
  calendarId: idSchema,
  holidays: z
    .array(z.object({ date: isoDateSchema, name: holidayNameSchema }))
    .min(1)
    .max(400),
});

export const removeHolidaySchema = z.object({
  calendarId: idSchema,
  holidayId: idSchema,
});

/**
 * Parses the paste-a-list textarea: one holiday per line, "YYYY-MM-DD, Name"
 * or "YYYY-MM-DD Name". Returns rows and per-line errors rather than throwing,
 * so the dialog can show which lines are wrong while still offering to import
 * the rest.
 */
export function parseHolidayLines(input: string): {
  holidays: { date: string; name: string }[];
  errors: { line: number; text: string; reason: string }[];
} {
  const holidays: { date: string; name: string }[] = [];
  const errors: { line: number; text: string; reason: string }[] = [];
  const seen = new Set<string>();

  const lines = input.split("\n");
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (!text) continue;

    const match = text.match(/^(\d{4}-\d{2}-\d{2})[\s,;\t]+(.+)$/);
    if (!match) {
      errors.push({
        line: index + 1,
        text,
        reason: "Expected: 2026-01-01, New Year's Day",
      });
      continue;
    }

    const [, date, name] = match;
    const parsed = isoDateSchema.safeParse(date);
    if (!parsed.success) {
      errors.push({ line: index + 1, text, reason: "Not a real date." });
      continue;
    }
    if (seen.has(date)) {
      errors.push({ line: index + 1, text, reason: "Duplicate date." });
      continue;
    }

    seen.add(date);
    holidays.push({ date, name: name.trim().slice(0, 160) });
  }

  return { holidays, errors };
}
