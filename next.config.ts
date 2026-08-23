import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

// Content-Security-Policy tuned for this app's runtime needs:
// - Tailwind v4 injects runtime <style> tags, so style-src needs 'unsafe-inline'.
// - Next.js ships hydration payloads as inline <script> tags, so script-src
//   needs 'unsafe-inline' until the app moves to per-request nonces. Nonces
//   cannot come from here — `headers()` is static — so that step means adding a
//   middleware that mints one per request and sets the header there.
// - 'unsafe-eval' is DEV ONLY: Turbopack/HMR compiles modules through eval.
//   Nothing in the production bundle needs it, and leaving it on is what turns
//   a future injected string into executable script.
// - Cloudflare Turnstile loads its widget script and renders in an iframe.
// - Images come from same-origin, data:/blob: (avatars, QR codes), and https.
const isDev = process.env.NODE_ENV !== "production";

const umamiScriptUrl =
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ??
  (process.env.UMAMI_HOST_URL
    ? `${process.env.UMAMI_HOST_URL.replace(/\/+$/, "")}/script.js`
    : undefined);
let umamiOrigin = "https://cloud.umami.is";
if (umamiScriptUrl) {
  try {
    umamiOrigin = new URL(umamiScriptUrl).origin;
  } catch {
    // ignore parse error
  }
}
const umamiScriptHosts = Array.from(
  new Set(["https://cloud.umami.is", umamiOrigin]),
).join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com ${umamiScriptHosts}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src 'self' https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Serwist's Turbopack integration must not run in development. Disabling just
// the provider still leaves the worker build hooks active, and an already
// installed worker can repeatedly intercept HMR/RSC chunks and force full
// document reloads. Production remains PWA-enabled.
export default isDev ? nextConfig : withSerwist(nextConfig);
