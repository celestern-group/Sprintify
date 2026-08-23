import "server-only";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

type AuditActor = { id?: string | null; email?: string | null };

// Fire-and-forget audit writer. Never throws — an audit-log failure must not
// fail the operation it records, so errors are swallowed to Sentry. Callers
// pass the actor explicitly (server actions already hold the session; auth
// hooks pass the acting user) to keep this free of session/auth imports and
// avoid a circular dependency with src/lib/auth.ts.
export async function recordAudit(input: {
  action: string;
  organizationId?: string | null;
  actor?: AuditActor | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    let ipAddress: string | null = null;
    try {
      const h = await headers();
      ipAddress =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null;
    } catch {
      // headers() is unavailable outside a request scope; leave IP null.
    }

    await db.insert(auditLog).values({
      organizationId: input.organizationId ?? null,
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      ipAddress,
    });
  } catch (error) {
    Sentry.captureException(error);
  }
}
