"use server";

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { notification } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { findCallerMembership } from "@/lib/project-access";
import { requireAuth } from "@/lib/session";

// The bell's read and write paths. Every query is scoped to the CALLER'S own
// member row, resolved from the session — a notification id from the client is
// only ever matched inside that scope, so nobody can read or mark someone
// else's bell.

const BELL_LIMIT = 20;

export type NotificationRow = {
  id: string;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
};

export type BellData = {
  notifications: NotificationRow[];
  unreadCount: number;
};

/** The caller's membership in this org, or null when they have none. */
async function callerMembership(organizationId: string) {
  const session = await requireAuth();
  const membership = await findCallerMembership(
    session.user.id,
    organizationId,
  );
  return { session, membership };
}

export async function getBellData(input: {
  organizationId: string;
}): Promise<BellData> {
  const { membership } = await callerMembership(input.organizationId);
  if (!membership) return { notifications: [], unreadCount: 0 };

  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notification.id,
        action: notification.action,
        actorName: notification.actorName,
        actorEmail: notification.actorEmail,
        targetType: notification.targetType,
        targetId: notification.targetId,
        metadata: notification.metadata,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })
      .from(notification)
      // Unread only: the bell is an inbox, not a history. A row leaves the list
      // the moment it is opened or "Mark all read" runs; auditLog keeps the record.
      .where(
        and(
          eq(notification.recipientMemberId, membership.id),
          isNull(notification.readAt),
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(BELL_LIMIT),
    db
      .select({ value: count() })
      .from(notification)
      .where(
        and(
          eq(notification.recipientMemberId, membership.id),
          isNull(notification.readAt),
        ),
      ),
  ]);

  return { notifications: rows, unreadCount: unread?.value ?? 0 };
}

const markReadSchema = z.object({
  organizationId: z.string(),
  notificationId: z.string(),
});

export async function markNotificationRead(input: {
  organizationId: string;
  notificationId: string;
}) {
  const parsed = markReadSchema.parse(input);
  const { session, membership } = await callerMembership(parsed.organizationId);
  if (!membership) return;

  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.id, parsed.notificationId),
        eq(notification.recipientMemberId, membership.id),
        isNull(notification.readAt),
      ),
    );

  await recordAudit({
    action: "notification.read",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "notification",
    targetId: parsed.notificationId,
  });
  // The bell renders from both shells' layouts.
  revalidatePath("/app/[orgSlug]", "layout");
  revalidatePath("/manage-org/[slug]", "layout");
}

const markAllReadSchema = z.object({ organizationId: z.string() });

export async function markAllNotificationsRead(input: {
  organizationId: string;
}) {
  const parsed = markAllReadSchema.parse(input);
  const { session, membership } = await callerMembership(parsed.organizationId);
  if (!membership) return;

  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.recipientMemberId, membership.id),
        isNull(notification.readAt),
      ),
    );

  await recordAudit({
    action: "notification.readAll",
    organizationId: parsed.organizationId,
    actor: { id: session.user.id, email: session.user.email },
    targetType: "member",
    targetId: membership.id,
  });
  // The bell renders from both shells' layouts.
  revalidatePath("/app/[orgSlug]", "layout");
  revalidatePath("/manage-org/[slug]", "layout");
}
