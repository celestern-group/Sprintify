import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResult } from "pg";
import * as schema from "@/db/schema";
import { env } from "@/env";

// Reuse one pool across dev HMR reloads AND across bundle layers. Next builds
// the server in more than one chunk graph (rsc / ssr), so this module can be
// instantiated twice in production too — without the global, that is two pools
// and 2x `max` sockets against the database.
const globalForDb = globalThis as unknown as { pool?: Pool };

const CONNECT_RETRIES = 2;
const CONNECT_RETRY_BASE_MS = 150;

type RawQuery = (...args: unknown[]) => Promise<QueryResult>;

/**
 * Errors raised while *acquiring* a connection, before any SQL reached the
 * server. Retrying these is side-effect-free by definition — nothing ran. The
 * list is deliberately narrow: a socket that dies mid-statement is NOT here,
 * because a write may or may not have committed and a retry could double it.
 */
function isConnectAcquireError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "Connection terminated due to connection timeout" ||
    error.message.startsWith("timeout exceeded when trying to connect")
  );
}

// A single refused/timed-out connect currently 500s whatever page asked for it,
// and because every waiter in the pool queue is rejected by that same failed
// connect, one blip fails a whole burst of requests at once.
async function retryingQuery(
  query: RawQuery,
  args: unknown[],
): Promise<QueryResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await query(...args);
    } catch (error) {
      if (attempt >= CONNECT_RETRIES || !isConnectAcquireError(error)) {
        throw error;
      }
      console.warn(
        `[db] connect failed (attempt ${attempt + 1}/${CONNECT_RETRIES + 1}), retrying`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, CONNECT_RETRY_BASE_MS * 2 ** attempt),
      );
    }
  }
}

function createPool() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    // Recycle before the network path (firewall/NAT/pooler) silently drops an
    // idle socket, which surfaces as "Connection terminated unexpectedly".
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // A statement that hangs pins its pool slot forever and the pool starves —
    // which is how one slow query becomes a site-wide connect timeout.
    // statement_timeout is enforced by the server, query_timeout by the client
    // (so it also covers a server that has stopped answering at all).
    statement_timeout: 20_000,
    query_timeout: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  // Without this, an error on an idle client is an unhandled 'error' event and
  // takes the process down.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });

  const query = pool.query.bind(pool) as RawQuery;

  // biome-ignore lint/suspicious/noExplicitAny: mirrors pg's own overloaded signature
  pool.query = ((...args: any[]) => {
    // pg's callback form returns undefined, not a promise — don't wrap it.
    if (typeof args.at(-1) === "function") return query(...args);
    return retryingQuery(query, args);
    // biome-ignore lint/suspicious/noExplicitAny: see above
  }) as any;

  return pool;
}

const pool = globalForDb.pool ?? createPool();
globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema });
