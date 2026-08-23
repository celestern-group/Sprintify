import "server-only";
import { auth } from "@/lib/auth";
import {
  MCP_READ_PERMISSION,
  MCP_WRITE_PERMISSION,
} from "@/lib/mcp/permissions";

/** Extracts a Bearer token without ever logging or returning it to callers. */
export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

/** Resolves a Better Auth API key to its owning user. */
export async function authenticateMcpRequest(
  request: Request,
): Promise<{ userId: string; canWrite: boolean } | null> {
  const key = bearerToken(request);
  if (!key) return null;

  try {
    const result = await auth.api.verifyApiKey({
      body: { key, permissions: MCP_READ_PERMISSION },
    });
    // The default Better Auth API-key configuration references its owning user
    // through the generic `referenceId` field.
    if (!result.valid || !result.key?.referenceId) return null;
    const writeResult = await auth.api.verifyApiKey({
      body: { key, permissions: MCP_WRITE_PERMISSION },
    });
    return {
      userId: result.key.referenceId,
      canWrite: Boolean(writeResult.valid),
    };
  } catch {
    // Invalid, expired, or disabled credentials are intentionally
    // indistinguishable to the caller and aren't sent to error reporting.
    return null;
  }
}
