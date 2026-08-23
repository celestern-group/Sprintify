import type { NextRequest } from "next/server";
import { requireProjectPermission } from "@/lib/project-access";
import {
  projectBacklogTopic,
  type RealtimeEvent,
  subscribeRealtime,
} from "@/lib/realtime";
import { loadProjectOrThrow } from "@/lib/work-item-access";

// A project-wide change signal for open backlog and board views. It contains
// no rows: a client re-reads through its normal permission-checked page render.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let project: Awaited<ReturnType<typeof loadProjectOrThrow>>;
  try {
    project = await loadProjectOrThrow(projectId);
    await requireProjectPermission(
      project.organizationId,
      project.id,
      "backlog:view",
      { project: ["update"] },
      "You don't have permission to view this project's backlog.",
    );
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const topic = projectBacklogTopic(project.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The runtime may have already closed the stream.
        }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      send("retry: 3000\n\n");
      send(`event: ready\ndata: ${JSON.stringify({ topic })}\n\n`);
      unsubscribe = subscribeRealtime(topic, (event: RealtimeEvent) => {
        send(`event: backlog\ndata: ${JSON.stringify(event.detail ?? {})}\n\n`);
      });
      heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
