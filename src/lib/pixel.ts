/**
 * Umami Tracking Pixel Utilities
 * Reference: https://docs.umami.is/docs/pixels
 *
 * Provides functions for generating Umami pixel URLs and embedding them in
 * emails and other non-JS HTML contexts.
 */
import { env } from "@/env";

/**
 * Resolves the Umami host base URL.
 */
export function getUmamiHostUrl(overrideHost?: string): string {
  if (overrideHost) {
    return overrideHost.replace(/\/+$/, "");
  }

  if (env.UMAMI_HOST_URL) {
    return env.UMAMI_HOST_URL.replace(/\/+$/, "");
  }
  if (env.NEXT_PUBLIC_UMAMI_SCRIPT_URL) {
    try {
      return new URL(env.NEXT_PUBLIC_UMAMI_SCRIPT_URL).origin;
    } catch {
      // Fallback
    }
  }

  return "https://cloud.umami.is";
}

/**
 * Derives the configured pixel ID from argument or environment variables.
 */
export function resolvePixelId(pixelId?: string): string | null {
  if (pixelId?.trim()) {
    return pixelId.trim();
  }

  const envPixel = env.UMAMI_PIXEL_ID || env.NEXT_PUBLIC_UMAMI_PIXEL_ID;
  if (envPixel?.trim()) {
    return envPixel.trim();
  }

  return null;
}

/**
 * Generates an Umami tracking pixel URL conforming to Umami v3+ pixel endpoint:
 * https://<umami-host>/p/<pixel-id>
 */
export function getUmamiPixelUrl(
  pixelId?: string,
  hostUrl?: string,
): string | null {
  const resolvedId = resolvePixelId(pixelId);
  if (!resolvedId) {
    return null;
  }

  // If already a full URL (e.g. "https://umami.celestern.com/p/uvTU00XJB")
  if (resolvedId.startsWith("http://") || resolvedId.startsWith("https://")) {
    return resolvedId.replace(/\/+$/, "");
  }

  const base = getUmamiHostUrl(hostUrl);
  return `${base}/p/${encodeURIComponent(resolvedId)}`;
}

/**
 * Generates an HTML <img> snippet for embedding in emails or non-JS pages.
 */
export function getPixelHtml(pixelId?: string, hostUrl?: string): string {
  const url = getUmamiPixelUrl(pixelId, hostUrl);
  if (!url) {
    return "";
  }

  return `<img src="${url}" width="1" height="1" style="display:none;" alt="" />`;
}
