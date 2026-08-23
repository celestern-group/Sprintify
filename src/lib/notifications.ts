import "server-only";
import * as Sentry from "@sentry/nextjs";
import { inArray } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { member, notification } from "@/db/schema";

type NotifyActor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  /** The actor's own member row in this org, filtered out of the recipients. */
  memberId?: string | null;
};

/**
 * Fan a mutation out to its recipients' bells. Call sites sit next to
 * recordAudit and share its contract: never throws — a notification failure
 * must not fail the operation it announces, so errors are swallowed to Sentry.
 * The insert runs post-response via `after()` (like scheduleEmbedding); the
 * recipients see it on their next request either way, so the actor's request
 * shouldn't wait on it.
 *
 * Recipients are member ids (the table anchors to `member`, mirroring
 * teamMember). The actor's own membership is dropped — nobody needs a bell for
 * what they just did themselves — and the list is de-duplicated so "assignee +
 * reporter" collapsing to one person yields one row.
 */
export function scheduleNotifications(input: {
  organizationId: string;
  recipientMemberIds: (string | null | undefined)[];
  actor?: NotifyActor | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}): void {
  const recipients = Array.from(
    new Set(
      input.recipientMemberIds.filter(
        (id): id is string => !!id && id !== input.actor?.memberId,
      ),
    ),
  );
  if (recipients.length === 0) return;

  after(async () => {
    try {
      // Membership can have changed between the mutation and this running;
      // the FK would reject a vanished member and take the whole batch with
      // it, so verify the survivors first.
      const existing = await db
        .select({ id: member.id })
        .from(member)
        .where(inArray(member.id, recipients));
      if (existing.length === 0) return;

      await db.insert(notification).values(
        existing.map((row) => ({
          organizationId: input.organizationId,
          recipientMemberId: row.id,
          actorId: input.actor?.id ?? null,
          actorName: input.actor?.name ?? null,
          actorEmail: input.actor?.email ?? null,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          metadata: input.metadata ?? null,
        })),
      );
    } catch (error) {
      Sentry.captureException(error);
    }
  });
}
