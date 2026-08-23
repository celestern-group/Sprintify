"use server";

import { and, count, eq, ilike, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { member, organization, user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertPlatformNotLocked } from "@/lib/platform-lockdown";
import { requireAdminAction } from "@/lib/session";

function revalidateAdminOrganizations() {
  revalidatePath("/admin/organizations", "page");
  revalidatePath("/admin/organizations/[id]", "page");
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function assertValidSlug(slug: string) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      "Slug must be lowercase letters, numbers, and hyphens only.",
    );
  }
}

async function assertSlugAvailable(slug: string, excludeId?: string) {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw new Error("That slug is already taken.");
  }
}

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberCount: number;
  ownerName: string | null;
  ownerEmail: string | null;
};

export async function listOrganizations({
  search,
  limit,
  offset,
}: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ organizations: OrganizationRow[]; total: number }> {
  await requireAdminAction();

  const whereClause = search
    ? or(
        ilike(organization.name, `%${search}%`),
        ilike(organization.slug, `%${search}%`),
      )
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      })
      .from(organization)
      .where(whereClause)
      .orderBy(organization.name)
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(organization).where(whereClause),
  ]);

  const orgIds = rows.map((row) => row.id);
  const [memberCounts, owners] = await Promise.all([
    orgIds.length
      ? db
          .select({ organizationId: member.organizationId, value: count() })
          .from(member)
          .where(inArray(member.organizationId, orgIds))
          .groupBy(member.organizationId)
      : [],
    orgIds.length
      ? db
          .select({
            organizationId: member.organizationId,
            name: user.name,
            email: user.email,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(
            and(
              inArray(member.organizationId, orgIds),
              eq(member.role, "owner"),
            ),
          )
      : [],
  ]);

  const memberCountByOrg = new Map(
    memberCounts.map((row) => [row.organizationId, row.value]),
  );
  const ownerByOrg = new Map(owners.map((row) => [row.organizationId, row]));

  return {
    organizations: rows.map((row) => ({
      ...row,
      memberCount: memberCountByOrg.get(row.id) ?? 0,
      ownerName: ownerByOrg.get(row.id)?.name ?? null,
      ownerEmail: ownerByOrg.get(row.id)?.email ?? null,
    })),
    total,
  };
}

export type OrganizationMemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

export type OrganizationDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  members: OrganizationMemberRow[];
};

export async function getOrganization(
  id: string,
): Promise<OrganizationDetail | null> {
  await requireAdminAction();

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  if (!org) return null;

  const members = await db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, id));

  members.sort((a, b) => {
    if (a.role === b.role) return a.name.localeCompare(b.name);
    if (a.role === "owner") return -1;
    if (b.role === "owner") return 1;
    if (a.role === "admin") return -1;
    if (b.role === "admin") return 1;
    return 0;
  });

  return { ...org, members };
}

const createOrganizationSchema = z.object({
  name: z.string().max(200),
  slug: z.string().regex(SLUG_PATTERN),
  ownerUserId: z.string(),
});

export async function createOrganization(input: {
  name: string;
  slug: string;
  ownerUserId: string;
}) {
  const parsed = createOrganizationSchema.parse(input);
  const session = await requireAdminAction();
  await assertPlatformNotLocked();

  assertValidSlug(parsed.slug);
  await assertSlugAvailable(parsed.slug);

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, parsed.ownerUserId))
    .limit(1);
  if (!owner) throw new Error("Selected owner not found.");

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id,
      name: parsed.name,
      slug: parsed.slug,
      createdAt: new Date(),
    });
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: id,
      userId: parsed.ownerUserId,
      role: "owner",
      createdAt: new Date(),
    });
  });

  await recordAudit({
    action: "organization.created",
    organizationId: id,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: id,
    metadata: {
      name: parsed.name,
      slug: parsed.slug,
      ownerUserId: parsed.ownerUserId,
    },
  });
  revalidateAdminOrganizations();

  return id;
}

const updateOrganizationSchema = z.object({
  name: z.string().max(200),
  slug: z.string().regex(SLUG_PATTERN),
});

export async function updateOrganization(
  id: string,
  input: { name: string; slug: string },
) {
  const orgId = z.string().parse(id);
  const parsed = updateOrganizationSchema.parse(input);
  const session = await requireAdminAction();

  assertValidSlug(parsed.slug);
  await assertSlugAvailable(parsed.slug, orgId);

  await db
    .update(organization)
    .set({ name: parsed.name, slug: parsed.slug })
    .where(eq(organization.id, orgId));

  await recordAudit({
    action: "organization.updated",
    organizationId: orgId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: orgId,
    metadata: { name: parsed.name, slug: parsed.slug },
  });
  revalidateAdminOrganizations();
}

export async function deleteOrganization(id: string) {
  const orgId = z.string().parse(id);
  const session = await requireAdminAction();
  await db.delete(organization).where(eq(organization.id, orgId));

  await recordAudit({
    action: "organization.deleted",
    organizationId: orgId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: orgId,
  });
  revalidateAdminOrganizations();
}

const assignOrganizationOwnerSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});

export async function assignOrganizationOwner(
  organizationId: string,
  userId: string,
) {
  const parsed = assignOrganizationOwnerSchema.parse({
    organizationId,
    userId,
  });
  const session = await requireAdminAction();

  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, parsed.userId))
    .limit(1);
  if (!target) throw new Error("User not found.");

  await db.transaction(async (tx) => {
    await tx
      .update(member)
      .set({ role: "admin" })
      .where(
        and(
          eq(member.organizationId, parsed.organizationId),
          eq(member.role, "owner"),
        ),
      );

    const [existingMembership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, parsed.organizationId),
          eq(member.userId, parsed.userId),
        ),
      )
      .limit(1);

    if (existingMembership) {
      await tx
        .update(member)
        .set({ role: "owner" })
        .where(eq(member.id, existingMembership.id));
    } else {
      await tx.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: parsed.organizationId,
        userId: parsed.userId,
        role: "owner",
        createdAt: new Date(),
      });
    }
  });

  await recordAudit({
    action: "organization.owner_assigned",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "organization",
    targetId: parsed.organizationId,
    metadata: { ownerUserId: parsed.userId },
  });
  revalidateAdminOrganizations();
}

const addOrganizationMemberSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  role: z.enum(["member", "admin"]),
});

/**
 * Platform-admin membership insert for an org the admin isn't part of.
 *
 * Invitations can't cover this: `organization.inviteMember` runs against the
 * caller's *active* org and needs a real `member` row with `invitation:create`,
 * so a platform admin has no invite path into a foreign org. Before this
 * existed, `assignOrganizationOwner` was the only way to add anyone — which
 * forced the new member to be owner and demoted the incumbent.
 *
 * Unlike owner reassignment (an administrative repair that must always be
 * possible), this is an ordinary member add.
 */
export async function addOrganizationMember(
  organizationId: string,
  userId: string,
  role: "member" | "admin",
) {
  const parsed = addOrganizationMemberSchema.parse({
    organizationId,
    userId,
    role,
  });
  const session = await requireAdminAction();

  const [target] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, parsed.userId))
    .limit(1);
  if (!target) throw new Error("User not found.");

  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, parsed.organizationId),
        eq(member.userId, parsed.userId),
      ),
    )
    .limit(1);
  if (existing) {
    throw new Error("That user is already a member of this organization.");
  }

  const id = crypto.randomUUID();
  await db.insert(member).values({
    id,
    organizationId: parsed.organizationId,
    userId: parsed.userId,
    role: parsed.role,
    createdAt: new Date(),
  });

  await recordAudit({
    action: "member.added",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: id,
    metadata: {
      userId: parsed.userId,
      email: target.email,
      role: parsed.role,
    },
  });
  revalidateAdminOrganizations();

  return id;
}

const setMemberRoleSchema = z.object({
  organizationId: z.string(),
  memberId: z.string(),
  role: z.enum(["member", "admin"]),
});

export async function setMemberRole(
  organizationId: string,
  memberId: string,
  role: "member" | "admin",
) {
  const parsed = setMemberRoleSchema.parse({ organizationId, memberId, role });
  const session = await requireAdminAction();

  const [target] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, parsed.memberId),
        eq(member.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner") {
    throw new Error("Reassign the owner instead of changing their role.");
  }

  await db
    .update(member)
    .set({ role: parsed.role })
    .where(eq(member.id, parsed.memberId));

  await recordAudit({
    action: "member.role_updated",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: parsed.memberId,
    metadata: { role: parsed.role },
  });
  revalidateAdminOrganizations();
}

const removeOrganizationMemberSchema = z.object({
  organizationId: z.string(),
  memberId: z.string(),
});

export async function removeOrganizationMember(
  organizationId: string,
  memberId: string,
) {
  const parsed = removeOrganizationMemberSchema.parse({
    organizationId,
    memberId,
  });
  const session = await requireAdminAction();

  const [target] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, parsed.memberId),
        eq(member.organizationId, parsed.organizationId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Member not found.");
  if (target.role === "owner") {
    throw new Error("Assign a new owner before removing this member.");
  }

  await db.delete(member).where(eq(member.id, parsed.memberId));

  await recordAudit({
    action: "member.removed",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: parsed.memberId,
    metadata: { previousRole: target.role },
  });
  revalidateAdminOrganizations();
}
