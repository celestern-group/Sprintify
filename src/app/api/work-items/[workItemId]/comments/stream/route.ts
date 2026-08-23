import type { NextRequest } from "next/server";
import { requireProjectPermission } from "@/lib/project-access";
import {
  type RealtimeEvent,
  subscribeRealtime,
  workItemCommentsTopic,
} from "@/lib/realtime";
import { loadWorkItemOrThrow } from "@/lib/work-item-access";

// The live half of the comment thread: one Server-Sent Events stream per open
// work item, fed by Postgres LISTEN/NOTIFY (src/lib/realtime.ts).
//
// The stream carries NO comment data — only "this thread changed". The client
// then re-reads through getWorkItemCommentThread, which re-checks the caller's
// permissions on every read. That is deliberate: a long-lived connection
// outlives the authorization that opened it (a role can be revoked, a member
// removed) and pushing rows down it would keep serving someone who has since
// lost access.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies and load balancers close a connection that has been quiet too long,
 * usually at 60s. A comment-only stream is quiet almost all the time, so it
 * sends an SSE comment line well inside that window to keep the pipe open.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  const { workItemId } = await params;

  // Same gate as the page itself. A failure here is a plain 403 rather than an
  // opened-then-closed stream, so EventSource does not sit there reconnecting
  // against a permission it will never get.
  let item: Awaited<ReturnType<typeof loadWorkItemOrThrow>>;
  try {
    item = await loadWorkItemOrThrow(workItemId);
    await requireProjectPermission(
      item.organizationId,
      item.projectId,
      "backlog:view",
      { project: ["update"] },
      "You don't have permission to view this project's backlog.",
    );
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const topic = workItemCommentsTopic(item.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the check and the enqueue.
          close();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // `retry` sets the browser's own reconnect delay. EventSource reconnects
      // on its own, so there is no reconnect logic on the client — but its
      // default backoff is unspecified, and 3s is a reasonable floor for a
      // dropped proxy connection.
      send("retry: 3000\n\n");
      // An immediate hello flushes response headers through any buffering
      // proxy, so the client's `onopen` fires now rather than on first event.
      send(`event: ready\ndata: ${JSON.stringify({ topic })}\n\n`);

      unsubscribe = subscribeRealtime(topic, (event: RealtimeEvent) => {
        send(
          `event: comments\ndata: ${JSON.stringify(event.detail ?? {})}\n\n`,
        );
      });

      heartbeat = setInterval(() => {
        send(": keep-alive\n\n");
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // nginx buffers proxied responses by default, which holds every event
      // until the buffer fills — for a stream that is never.
      "x-accel-buffering": "no",
    },
  });
}
