import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { holidayCalendar } from "@/db/schema";

// The calendar a project inherits when it hasn't pinned one of its own.
// Deliberately created EMPTY: we don't know the organization's region, and
// guessing public holidays wrongly is worse than showing none — a wrong
// non-working day silently inflates or deflates every sprint's capacity.
export async function seedOrganizationDefaultCalendar(organizationId: string) {
  await db
    .insert(holidayCalendar)
    .values({
      organizationId,
      name: "Default",
      timezone: "UTC",
      isDefault: true,
      source: "local",
    })
    .onConflictDoNothing();
}

// Mirrors ensureOrganizationProjectRoles: SSO provisioning and direct adapter
// writes bypass the afterCreateOrganization hook, so read paths self-heal
// rather than dead-ending on an org with no calendar.
export async function ensureOrganizationDefaultCalendar(
  organizationId: string,
) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(holidayCalendar)
    .where(eq(holidayCalendar.organizationId, organizationId));

  if (value === 0) await seedOrganizationDefaultCalendar(organizationId);
}
