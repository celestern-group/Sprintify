import "server-only";
import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { db } from "@/db";
import { env } from "@/env";

// Server-push fan-out, on Postgres LISTEN/NOTIFY.
//
// Why this and not a WebSocket server: the only traffic is server → client
// (every write already goes through a server action), and a Next route handler
// can return a ReadableStream but cannot answer an HTTP upgrade — a WebSocket
// would mean a custom Node server, a different start command and a widened
// CSP, to carry a channel nothing sends up. See the SSE route in
// src/app/api/work-items/[workItemId]/comments/stream.
//
// Why NOTIFY and not an in-process EventEmitter alone: two app instances behind
// a load balancer hold different halves of the readers. The emitter fans out
// within ONE process; Postgres is what gets the event to the other one. Both
// halves are here — publish goes to Postgres, and every process (including the
// publisher's own) picks it up off its LISTEN connection.

/** One channel for everything; the topic inside the payload does the routing. */
const CHANNEL = "sprintify_realtime";

/**
 * NOTIFY payloads are capped at 8000 bytes and are NOT a delivery guarantee —
 * a listener that reconnects misses whatever fired while it was gone. So an
 * event says only "this topic changed"; the subscriber re-reads through the
 * normal, permission-checked server action. That also means the stream can
 * never leak data the reader isn't allowed to see.
 */
export type RealtimeEvent = {
  topic: string;
  /** Free-form, small. Never anything the recipient isn't already cleared for. */
  detail?: Record<string, string | number | null>;
};

type Listener = (event: RealtimeEvent) => void;

// Module state survives HMR the same way the db pool does — a fresh listener
// client per reload would leak a connection per edit.
const globalForRealtime = globalThis as unknown as {
  realtimeSubscribers?: Map<string, Set<Listener>>;
  realtimeClient?: Client | null;
  realtimeConnecting?: Promise<void> | null;
  realtimeRetryMs?: number;
};

const subscribers: Map<
  string,
  Set<Listener>
> = globalForRealtime.realtimeSubscribers ?? new Map();
globalForRealtime.realtimeSubscribers = subscribers;

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Announce that `topic` changed. Fire-and-forget with the same contract as
 * recordAudit: never throws, because a dropped live update must not fail the
 * mutation that earned it — the next navigation or reconnect reconciles.
 */
export function publishRealtime(event: RealtimeEvent): void {
  // pg_notify() rather than a NOTIFY statement: the payload is a VALUE here,
  // so it binds as a parameter instead of being interpolated into SQL.
  void db
    .execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`)
    .catch((error) => {
      Sentry.captureException(error);
    });
}

/**
 * Listen for events on one topic. Returns the unsubscribe function; call it
 * from the stream's cancel/abort path or the connection leaks a listener.
 */
export function subscribeRealtime(
  topic: string,
  listener: Listener,
): () => void {
  const existing = subscribers.get(topic);
  if (existing) existing.add(listener);
  else subscribers.set(topic, new Set([listener]));

  // Lazy: an app that never opens a stream never opens a second connection.
  void ensureListening();

  return () => {
    const set = subscribers.get(topic);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) subscribers.delete(topic);
  };
}

/**
 * The LISTEN connection is a dedicated `pg.Client`, deliberately NOT a pooled
 * one: a pooled client is handed back after each query, and LISTEN state is
 * per-connection — the next checkout would silently stop receiving.
 */
async function ensureListening(): Promise<void> {
  if (globalForRealtime.realtimeClient) return;
  if (globalForRealtime.realtimeConnecting) {
    return globalForRealtime.realtimeConnecting;
  }

  const connecting = (async () => {
    const client = new Client({
      connectionString: env.DATABASE_URL,
      keepAlive: true,
    });

    client.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.payload) as RealtimeEvent;
      } catch {
        return;
      }
      const listeners = subscribers.get(event.topic);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          // One broken stream must not stop delivery to the rest.
          Sentry.captureException(error);
        }
      }
    });

    client.on("error", (error) => {
      Sentry.captureException(error);
      scheduleReconnect();
    });
    client.on("end", scheduleReconnect);

    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);

    globalForRealtime.realtimeClient = client;
    globalForRealtime.realtimeRetryMs = INITIAL_RETRY_MS;
  })().catch((error) => {
    Sentry.captureException(error);
    scheduleReconnect();
  });

  globalForRealtime.realtimeConnecting = connecting.finally(() => {
    globalForRealtime.realtimeConnecting = null;
  });
  return globalForRealtime.realtimeConnecting;
}

/**
 * Reconnect with backoff, but only while something is still listening — an
 * idle process should not hold a connection open forever retrying. Events that
 * fired during the gap are lost by design; subscribers re-read on reconnect.
 */
function scheduleReconnect(): void {
  const client = globalForRealtime.realtimeClient;
  globalForRealtime.realtimeClient = null;
  if (client) void client.end().catch(() => {});

  if (subscribers.size === 0) {
    globalForRealtime.realtimeRetryMs = INITIAL_RETRY_MS;
    return;
  }

  const delay = globalForRealtime.realtimeRetryMs ?? INITIAL_RETRY_MS;
  globalForRealtime.realtimeRetryMs = Math.min(delay * 2, MAX_RETRY_MS);
  setTimeout(() => {
    if (subscribers.size > 0) void ensureListening();
  }, delay).unref?.();
}

/** The topic one work item's comment thread publishes on. */
export function workItemCommentsTopic(workItemId: string): string {
  return `workItemComments:${workItemId}`;
}

/** A project-wide signal for every backlog-shaped view of one project. */
export function projectBacklogTopic(projectId: string): string {
  return `projectBacklog:${projectId}`;
}
