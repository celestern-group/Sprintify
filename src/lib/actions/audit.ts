"use server";

import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, member, organization, user } from "@/db/schema";
import { hasAdminRole } from "@/lib/roles";
import { getSession, requireAuth } from "@/lib/session";

const ORG_MANAGE_ROLES = new Set(["owner", "admin"]);

// Shape returned to both the org-scoped and platform-scoped views. `actorName`
// falls back to the denormalized `actorEmail` when the acting user has since
// been deleted (the FK is ON DELETE SET NULL). `organizationName` is only
// populated for the platform view.
export type AuditLogRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
  organizationId: string | null;
  organizationName: string | null;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  actions: string[];
};

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  action: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
});

// A free-text search spans the actor (name/email), the target id and the raw
// action string, so an admin can paste an id or a person and find their trail.
function searchClause(search: string) {
  const term = `%${search}%`;
  return or(
    ilike(user.name, term),
    ilike(user.email, term),
    ilike(auditLog.actorEmail, term),
    ilike(auditLog.action, term),
    ilike(auditLog.targetId, term),
  );
}

async function resolveManagedOrg(slug: string) {
  const session = await requireAuth();

  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!org) throw new Error("Organization not found.");

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, org.id),
      ),
    )
    .limit(1);
  if (!membership || !ORG_MANAGE_ROLES.has(membership.role)) {
    throw new Error("You must be an organization owner or admin.");
  }

  return org;
}

/**
 * Org-scoped audit trail: only rows belonging to the org identified by `slug`,
 * gated to that org's owners/admins. Platform-level events (null
 * organizationId) never appear here.
 */
export async function listOrgAuditLog(input: {
  slug: string;
  search?: string;
  action?: string;
  limit: number;
  offset: number;
}): Promise<AuditLogPage> {
  const { search, action, limit, offset } = listSchema.parse(input);
  const org = await resolveManagedOrg(input.slug);

  const filters = [eq(auditLog.organizationId, org.id)];
  if (action) filters.push(eq(auditLog.action, action));
  if (search) {
    const clause = searchClause(search);
    if (clause) filters.push(clause);
  }
  const where = and(...filters);

  const [rows, [totals], actionRows] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorId: auditLog.actorId,
        actorName: user.name,
        actorEmail: auditLog.actorEmail,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        metadata: auditLog.metadata,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
        organizationId: auditLog.organizationId,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.actorId, user.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(auditLog).where(where),
    db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.organizationId, org.id))
      .orderBy(auditLog.action),
  ]);

  return {
    rows: rows.map((row) => ({ ...row, organizationName: org.name })),
    total: totals?.value ?? 0,
    actions: actionRows.map((row) => row.action),
  };
}

/**
 * Platform-scoped audit trail for platform admins: every row across all orgs,
 * including org-agnostic system/platform events (null organizationId). Supports
 * an optional org filter.
 */
export async function listPlatformAuditLog(input: {
  search?: string;
  action?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}): Promise<AuditLogPage> {
  const session = await getSession();
  if (!session || !hasAdminRole(session.user.role)) {
    throw new Error("Admins only.");
  }
  const { search, action, limit, offset } = listSchema.parse(input);

  const filters = [];
  if (action) filters.push(eq(auditLog.action, action));
  if (input.organizationId) {
    filters.push(eq(auditLog.organizationId, input.organizationId));
  }
  if (search) {
    const clause = or(
      searchClause(search),
      ilike(organization.name, `%${search}%`),
    );
    if (clause) filters.push(clause);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [totals], actionRows] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorId: auditLog.actorId,
        actorName: user.name,
        actorEmail: auditLog.actorEmail,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        metadata: auditLog.metadata,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
        organizationId: auditLog.organizationId,
        organizationName: organization.name,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.actorId, user.id))
      .leftJoin(organization, eq(auditLog.organizationId, organization.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(auditLog).where(where),
    db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .orderBy(auditLog.action),
  ]);

  return {
    rows,
    total: totals?.value ?? 0,
    actions: actionRows.map((row) => row.action),
  };
}

// Platform admins pick an org to filter the trail by; kept minimal (id + name)
// and independent of the paginated admin-organizations list.
export async function listAuditOrganizations(): Promise<
  { id: string; name: string }[]
> {
  const session = await getSession();
  if (!session || !hasAdminRole(session.user.role)) {
    throw new Error("Admins only.");
  }
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(
      sql`${organization.id} in (select distinct ${auditLog.organizationId} from ${auditLog})`,
    )
    .orderBy(organization.name);
}
