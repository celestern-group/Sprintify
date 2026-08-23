import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit } from "@/db/schema";

// This route sits outside Better Auth's HTTP handler, so it consumes a
// separate, namespaced bucket in Better Auth's shared database rate-limit
// store. The atomic upsert works across Next.js instances.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "no-trusted-ip"
  );
}

/** Returns false when this client has exhausted its MCP request bucket. */
export async function consumeMcpRequest(request: Request): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const key = `mcp:${clientIp(request)}`;

  const consumed = await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case
          when ${rateLimit.lastRequest} <= ${windowStart} then 1
          else ${rateLimit.count} + 1
        end`,
        lastRequest: now,
      },
      // Do not extend the window after a refusal; it must expire from the
      // first request in the window rather than becoming a sliding lockout.
      setWhere: sql`${rateLimit.lastRequest} <= ${windowStart}
        or ${rateLimit.count} < ${MAX_REQUESTS}`,
    })
    .returning({ count: rateLimit.count });

  return consumed.length > 0;
}
