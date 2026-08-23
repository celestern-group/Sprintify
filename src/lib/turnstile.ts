import "server-only";

import { headers } from "next/headers";
import { env } from "@/env";

const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

function secretKey() {
  if (env.TURNSTILE_SECRET_KEY) return env.TURNSTILE_SECRET_KEY;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing TURNSTILE_SECRET_KEY. Set it in production so request access is protected.",
    );
  }
  return TURNSTILE_TEST_SECRET_KEY;
}

/** Verifies a Turnstile response for non-Better-Auth forms. */
export async function verifyTurnstile(token: string): Promise<void> {
  const requestHeaders = await headers();
  const remoteip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    undefined;
  const body = new URLSearchParams({ secret: secretKey(), response: token });
  if (remoteip) body.set("remoteip", remoteip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body, cache: "no-store" },
  );
  const result = (await response.json()) as { success?: boolean };
  if (!response.ok || !result.success) {
    throw new Error("Captcha verification failed. Please try again.");
  }
}
