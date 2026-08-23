"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { account, invitation, member, organization, user } from "@/db/schema";
import { OrganizationMemberAddedEmail } from "@/emails/organization-member-added";
import { env } from "@/env";
import { recordAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { hasOrgPermission, isUniqueViolation } from "@/lib/project-access";
import { requireAuth } from "@/lib/session";
import {
  addOrganizationMemberDirectlySchema,
  orgMemberRefSchema,
  orgRefSchema,
} from "@/lib/validation/org-members";

function revalidateOrgMembers() {
  revalidatePath("/manage-org/[slug]/members", "page");
  revalidatePath("/manage-org/[slug]", "page");
}

export type AddOrganizationMemberDirectlyResult = {
  email: string;
  role: "member" | "admin";
  /** True when this add provisioned the platform account, not just the membership. */
  accountCreated: boolean;
  /**
   * True when the person was mailed about this add — the "set your password"
   * link for a freshly provisioned account, or the "you've been added" notice
   * for one that already existed. False means the send failed; the membership
   * still stands.
   */
  notificationEmailSent: boolean;
  /** Pending invitations to the same address that this add made redundant. */
  invitationsSuperseded: number;
};

type TargetUser = {
  id: string;
  email: string;
  name: string | null;
  banned: boolean | null;
  banExpires: Date | null;
};

async function findUserByEmail(email: string): Promise<TargetUser | null> {
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row ?? null;
}

/**
 * A platform ban that is still in force.
 *
 * Better Auth stores a permanent ban as `banned: true` with a null `banExpires`
 * and a temporary one with a future timestamp; it only clears the flag lazily,
 * on the banned user's next sign-in attempt. So a stale `banned: true` whose
 * expiry has already passed is a normal, non-banned account and must not block
 * the add.
 */
function isActivelyBanned(target: {
  banned: boolean | null;
  banExpires: Date | null;
}): boolean {
  if (!target.banned) return false;
  return target.banExpires === null || target.banExpires.getTime() > Date.now();
}

/**
 * Users with no linked `account` row of any kind — provisioned by an admin (or
 * the invite flow) and never activated. They cannot sign in at all: password
 * sign-in needs a `credential` account, and social/SSO sign-in needs its own.
 *
 * Deliberately "no account rows" rather than "no credential row": somebody who
 * only ever signs in through SSO has no credential account either, and showing
 * them as awaiting activation would be wrong.
 */
async function findUnactivatedUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ userId: account.userId })
    .from(account)
    .where(inArray(account.userId, userIds));
  const activated = new Set(rows.map((row) => row.userId));
  return new Set(userIds.filter((id) => !activated.has(id)));
}

/**
 * The "set your password" mail, shared by the initial add and the resend.
 *
 * There is no invitation to accept, so the link lands on the org dashboard once
 * the password is set. `activate=1` is what tells sendResetPassword (src/lib/
 * auth.ts) to use the "set your password" copy instead of "reset your password".
 */
async function sendActivationLink(email: string, orgSlug: string) {
  await auth.api.requestPasswordReset({
    body: {
      email,
      redirectTo: `/reset-password?activate=1&next=${encodeURIComponent(
        `/app/${orgSlug}`,
      )}`,
    },
  });
}

/**
 * Voids invitations that a direct add has just made pointless.
 *
 * Without this the invite stays `pending` in the members panel forever, and if
 * the recipient later follows the emailed link `acceptInvitation` tries to
 * insert a second `member` row and trips `member_orgId_userId_uidx` — a raw
 * failure on their first interaction with the org. Better Auth's own
 * `inviteMember` cancels invitations the same way when the invitee is already a
 * member, so "canceled" is the status it expects to read back.
 */
async function cancelSupersededInvitations(
  organizationId: string,
  email: string,
): Promise<string[]> {
  const canceled = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
      ),
    )
    .returning({ id: invitation.id });
  return canceled.map((row) => row.id);
}

/**
 * Provisions the platform account for an address that has none.
 *
 * `auth.api.createUser` is called with no headers/request — Better Auth's
 * documented "server" calling convention, which skips the admin-plugin
 * permission gate (that gate only fires for a real incoming request). The org
 * admin's authority to do this was already established by the `member:create`
 * check in the caller; it is deliberately NOT the platform-admin grant.
 *
 * `emailVerified: true` is safe here even though nobody has proven control of
 * the inbox yet: the account ships with no credential (no `password`), so the
 * only way to ever use it is the set-password link that gets mailed to that
 * same address. The round-trip through the real inbox is the proof a
 * verification mail would otherwise collect — the same reasoning as
 * `ensureInviteeAccount` in src/lib/auth.ts.
 */
async function provisionUserAccount(
  email: string,
  name: string | undefined,
): Promise<TargetUser> {
  try {
    const created = await auth.api.createUser({
      body: { email, name: name ?? email, data: { emailVerified: true } },
    });
    return {
      id: created.user.id,
      email: created.user.email,
      name: created.user.name,
      banned: false,
      banExpires: null,
    };
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    if (code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") throw error;
    // Raced against another add/sign-up between the lookup and here — the row
    // now exists, so fall through and use it.
    const existing = await findUserByEmail(email);
    if (!existing) throw error;
    return existing;
  }
}

/**
 * Org-admin member add that skips the invitation round-trip.
 *
 * The invite flow (`organization.inviteMember`) needs the recipient to accept,
 * which is the wrong shape for the "I'm onboarding my team, here are their
 * addresses" case. This adds the `member` row straight away and, when the
 * address has no account yet, provisions one (pre-verified, password-less) and
 * mails a set-password link.
 *
 * Consent trade-off: an existing user is added without being asked, exactly
 * like the platform-admin `addOrganizationMember`. That is deliberate — the
 * caller already holds `member:create` on the org (owner/admin only, see
 * orgRoles in src/lib/permissions.ts), the add is audited with their identity,
 * and the member can leave. Membership grants no project access on its own;
 * that still flows through `projectMember`.
 */
export async function addOrganizationMemberDirectly(input: {
  organizationId: string;
  email: string;
  name?: string;
  role: "member" | "admin";
}): Promise<AddOrganizationMemberDirectlyResult> {
  const parsed = addOrganizationMemberDirectlySchema.parse(input);
  const session = await requireAuth();

  // `member:create` is the org-level "may add people" grant — owner/admin only.
  const allowed = await hasOrgPermission(parsed.organizationId, {
    member: ["create"],
  });
  if (!allowed) {
    throw new Error(
      "You don't have permission to add members to this organization.",
    );
  }

  // Platform lockdown freezes invitations (beforeCreateInvitation in
  // src/lib/auth.ts); this is the same door, so it freezes too. Checking up
  // front also keeps a locked-down provisioning attempt from failing halfway
  // through with the raw user.create hook error.
  await assertPlatformNotLocked();

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(eq(organization.id, parsed.organizationId))
    .limit(1);
  if (!org) throw new Error("Organization not found.");

  const existingUser = await findUserByEmail(parsed.email);
  if (existingUser) {
    // A platform ban outranks any org-level grant: the account cannot sign in.
    // Lifting the ban is a platform-admin
    // action (/admin/unban-user), not something an org admin can work around
    // from here.
    if (isActivelyBanned(existingUser)) {
      throw new Error(
        "That account is suspended platform-wide and can't be added. Contact a platform administrator.",
      );
    }

    const [existingMember] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, org.id),
          eq(member.userId, existingUser.id),
        ),
      )
      .limit(1);
    if (existingMember) {
      throw new Error("That person is already a member of this organization.");
    }
  }

  const accountCreated = !existingUser;
  const target =
    existingUser ?? (await provisionUserAccount(parsed.email, parsed.name));

  const memberId = crypto.randomUUID();
  try {
    await db.insert(member).values({
      id: memberId,
      organizationId: org.id,
      userId: target.id,
      role: parsed.role,
      createdAt: new Date(),
    });
  } catch (error) {
    // Unique violation on member_orgId_userId_uidx — a concurrent add or an
    // invitation accepted in the meantime.
    if (isUniqueViolation(error)) {
      throw new Error("That person is already a member of this organization.");
    }
    throw error;
  }

  const actor = { id: session.user.id, email: session.user.email };

  if (accountCreated) {
    // Better Auth's own hook also logs `user.created` for the createUser
    // endpoint, but headers-less server calls have no session to attribute it
    // to — this entry is the one that names who caused the account to exist.
    await recordAudit({
      action: "user.provisioned",
      organizationId: org.id,
      actor,
      targetType: "user",
      targetId: target.id,
      metadata: { email: target.email, via: "org_member_add" },
    });
  }

  await recordAudit({
    action: "member.added",
    organizationId: org.id,
    actor,
    targetType: "member",
    targetId: memberId,
    metadata: {
      userId: target.id,
      email: target.email,
      role: parsed.role,
      accountCreated,
    },
  });

  // They're a member now, so any invitation still asking them to become one is
  // dead weight — void it before it can be accepted into a unique violation.
  const supersededInvitations = await cancelSupersededInvitations(
    org.id,
    target.email,
  );
  for (const invitationId of supersededInvitations) {
    await recordAudit({
      action: "invitation.canceled",
      organizationId: org.id,
      actor,
      targetType: "invitation",
      targetId: invitationId,
      metadata: {
        email: target.email,
        reason: "superseded_by_direct_add",
        memberId,
      },
    });
  }

  let notificationEmailSent = false;
  if (accountCreated) {
    try {
      await sendActivationLink(target.email, org.slug);
      notificationEmailSent = true;
    } catch (error) {
      // The member row is already committed and the add is audited; a mail
      // failure must not roll that back. The admin is told to resend.
      console.error("Failed to send set-password email:", error);
    }
  } else {
    try {
      // Nothing to accept and no password to set, so this is the only signal
      // the person gets that they now belong to an org they never asked to
      // join. Silence here is the consent gap, not the add itself.
      await sendMail({
        to: target.email,
        subject: `You've been added to ${org.name}`,
        react: OrganizationMemberAddedEmail({
          userName: target.name,
          adderName: session.user.name || session.user.email,
          organizationName: org.name,
          roleLabel: parsed.role,
          organizationUrl: `${env.BETTER_AUTH_URL}/app/${org.slug}`,
        }),
      });
      notificationEmailSent = true;
    } catch (error) {
      // Same reasoning as above — the membership stands either way, and this
      // mail carries no link they can't reach by signing in normally.
      console.error("Failed to send member-added email:", error);
    }
  }

  revalidateOrgMembers();

  return {
    email: target.email,
    role: parsed.role,
    accountCreated,
    notificationEmailSent,
    invitationsSuperseded: supersededInvitations.length,
  };
}

/**
 * Re-sends the "set your password" link to a member who never activated.
 *
 * The activation link is a Better Auth password-reset token, and
 * `resetPasswordTokenExpiresIn` is global (default 1 hour) — deliberately kept
 * short so genuine "I forgot my password" links stay short-lived. That makes a
 * batch of Friday-afternoon adds unusable by Monday, so the admin needs a way
 * to re-issue one without deleting and re-adding the member.
 */
export async function resendMemberActivation(input: {
  organizationId: string;
  memberId: string;
}): Promise<{ email: string }> {
  const parsed = orgMemberRefSchema.parse(input);
  const session = await requireAuth();

  // Same grant as the add itself — re-issuing a sign-in link for an account is
  // no less sensitive than creating it.
  const allowed = await hasOrgPermission(parsed.organizationId, {
    member: ["create"],
  });
  if (!allowed) {
    throw new Error(
      "You don't have permission to manage members of this organization.",
    );
  }

  await assertPlatformNotLocked();

  const [row] = await db
    .select({
      memberId: member.id,
      userId: user.id,
      email: user.email,
      banned: user.banned,
      banExpires: user.banExpires,
      orgSlug: organization.slug,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(organization, eq(member.organizationId, organization.id))
    // Scoping by organizationId as well as id is what stops a member id from
    // another org being used to trigger mail from this one.
    .where(
      and(
        eq(member.id, parsed.memberId),
        eq(member.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Member not found in this organization.");

  if (isActivelyBanned(row)) {
    throw new Error("That account is suspended platform-wide.");
  }

  const unactivated = await findUnactivatedUserIds([row.userId]);
  if (!unactivated.has(row.userId)) {
    throw new Error(
      "That member has already set up their account and can sign in normally.",
    );
  }

  await sendActivationLink(row.email, row.orgSlug);

  await recordAudit({
    action: "member.activation_resent",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: row.memberId,
    metadata: { userId: row.userId, email: row.email },
  });

  revalidateOrgMembers();

  return { email: row.email };
}

/**
 * Member ids in this org whose accounts have never been activated, so the
 * members panel can mark them and offer a resend. Read-only, so it's gated on
 * plain membership rather than `member:create`.
 */
export async function listPendingMemberActivations(input: {
  organizationId: string;
}): Promise<string[]> {
  const parsed = orgRefSchema.parse(input);
  const session = await requireAuth();

  const [callerMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, parsed.organizationId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!callerMembership) return [];

  const rows = await db
    .select({ memberId: member.id, userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, parsed.organizationId));

  const unactivated = await findUnactivatedUserIds(
    rows.map((row) => row.userId),
  );
  return rows
    .filter((row) => unactivated.has(row.userId))
    .map((row) => row.memberId);
}
