import { z } from "zod";

// Input schema for the org-level "add a member directly" action
// (src/lib/actions/org-members.ts), kept in a plain module so it can be
// unit-tested — a "use server" file may only export async functions.

// Addresses are matched against `user.email` (stored lower-cased by Better
// Auth), so normalise before the email check rather than after: a pasted
// "  Ada@Example.COM " must resolve to the same account as "ada@example.com"
// instead of provisioning a second one.
export const orgMemberEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320));

export const addOrganizationMemberDirectlySchema = z.object({
  organizationId: z.string().min(1),
  email: orgMemberEmailSchema,
  // Optional: falls back to the email, matching how invite provisioning names
  // an account it creates before the person has told us anything about
  // themselves (ensureInviteeAccount in src/lib/auth.ts).
  name: z.string().trim().min(1).max(200).optional(),
  // `owner` is deliberately absent — transferring ownership is a separate,
  // destructive operation (it demotes the incumbent), not a member add.
  role: z.enum(["member", "admin"]),
});

export type AddOrganizationMemberDirectlyInput = z.input<
  typeof addOrganizationMemberDirectlySchema
>;

// Re-sending the activation link is keyed by `member.id` rather than an email:
// the caller may only act on people already inside the org they administer, and
// a member id can't be pointed at an arbitrary address the way a free-text
// email field could.
export const orgMemberRefSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
});

export type OrgMemberRefInput = z.input<typeof orgMemberRefSchema>;

export const orgRefSchema = z.object({
  organizationId: z.string().min(1),
});
