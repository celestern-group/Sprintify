"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  MCP_READ_PERMISSION,
  MCP_WRITE_PERMISSION,
} from "@/lib/mcp/permissions";
import { requireAuth } from "@/lib/session";

const createMcpKeySchema = z.object({
  name: z.string().trim().max(100).optional(),
  writeAccess: z.boolean().default(false),
});

/** Creates a personal MCP key; write scope is an explicit user choice. */
export async function createMcpApiKey(input: {
  name?: string;
  writeAccess?: boolean;
}) {
  const parsed = createMcpKeySchema.parse(input);
  const session = await requireAuth();
  const created = await auth.api.createApiKey({
    headers: await headers(),
    body: {
      name: parsed.name || undefined,
      userId: session.user.id,
      permissions: parsed.writeAccess
        ? MCP_WRITE_PERMISSION
        : MCP_READ_PERMISSION,
    },
  });

  // Better Auth's /api-key/create after-hook records this mutation exactly
  // once, alongside every other API-key create/update/delete operation.
  return { key: created.key };
}
