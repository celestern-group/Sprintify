import { z } from "zod";
import { isIsoDate } from "@/lib/date-only";

// Shared field schemas for the working-time and sprint actions. Kept in a
// plain module because a "use server" file may only export async functions.

/**
 * A calendar date with no time. Rejects "2026-02-30" as well as the wrong
 * shape — the DATE column would too, but a zod error is a message someone can
 * act on rather than a 22008 from the driver.
 */
export const isoDateSchema = z
  .string()
  .refine(isIsoDate, "Enter a date as YYYY-MM-DD.");

export const idSchema = z.string().min(1);

/** 0 = Sunday. At least one working day, no duplicates, sorted for stability. */
export const workingWeekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Pick at least one working day.")
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

export const hoursPerDaySchema = z.number().min(0).max(24);

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    // Intl is the authority on what the runtime will accept later; a bad zone
    // stored now would throw at format time, far from where it was entered.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone.");
