import "server-only";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";

type ServerEventPayload = {
  action: string;
  targetType?: string | null;
  url?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Derives the base URL of the Umami host from environment configuration.
 */
function getUmamiBaseUrl(): string {
  if (env.UMAMI_HOST_URL) {
    return env.UMAMI_HOST_URL.replace(/\/+$/, "");
  }

  const scriptUrl = env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  if (scriptUrl) {
    try {
      return new URL(scriptUrl).origin;
    } catch {
      // Fallback
    }
  }

  return "https://cloud.umami.is";
}

/**
 * Sends a server-side event to Umami Analytics via the /api/send endpoint.
 * Fire-and-forget; never throws so as not to interrupt mutations.
 */
export async function sendUmamiServerEvent(
  payload: ServerEventPayload,
): Promise<void> {
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) {
    return;
  }

  try {
    const baseUrl = getUmamiBaseUrl();
    const endpoint = `${baseUrl}/api/send`;

    // Audit metadata can contain personal or tenant-sensitive data (for
    // example invitee emails and attachment names). Analytics gets only this
    // small, stable allowlist rather than an implicit copy of every audit row.
    const cleanData: Record<string, string> = {};
    if (payload.targetType) {
      cleanData.targetType = payload.targetType;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": payload.userAgent || "Sprintify-Server/1.0",
    };
    if (payload.ipAddress) {
      headers["x-forwarded-for"] = payload.ipAddress;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "event",
        payload: {
          website: websiteId,
          hostname: new URL(env.BETTER_AUTH_URL).hostname,
          name: payload.action,
          data: Object.keys(cleanData).length > 0 ? cleanData : undefined,
          url: payload.url || `/api/action/${payload.action}`,
        },
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      // Swallowed silently or captured in debug
    }
  } catch (error) {
    // Analytics failures must never break user operations
    Sentry.captureException(error);
  }
}
