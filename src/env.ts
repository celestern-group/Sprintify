import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Centralized, validated environment access. Import `env` instead of reading
// `process.env` directly so a missing/malformed var fails fast at boot with a
// clear message. Set SKIP_ENV_VALIDATION=1 for lint/typecheck/Docker steps that
// build without real secrets (see .github/workflows/ci.yml).
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),

    // SMTP — required; the mailer cannot send without a full transport config.
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().min(1),
    SMTP_PASSWORD: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    EMAIL_FROM_NAME: z.string().optional(),

    // Captcha — optional in dev (falls back to Cloudflare's test secret),
    // enforced in production by turnstileSecretKey() in src/lib/auth.ts.
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // Storage — S3 fields validated lazily in src/lib/storage when selected.
    STORAGE_BACKEND: z.enum(["local", "s3"]).optional(),
    STORAGE_LOCAL_PATH: z.string().optional(),
    STORAGE_S3_BUCKET: z.string().optional(),
    STORAGE_S3_REGION: z.string().optional(),
    STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_S3_ENDPOINT: z.string().optional(),

    // AI provider secrets at rest — 32 random bytes, base64 or hex. Optional
    // here so existing deployments keep booting; src/lib/crypto.ts validates it
    // lazily and fails with a clear message the first time a provider API key
    // is written or read (see src/lib/actions/ai.ts).
    AI_ENCRYPTION_KEY: z.string().optional(),

    // Observability — no-op when unset.
    SENTRY_DSN: z.string().optional(),

    // Admin seed script (scripts/seed-admin.ts) — optional at runtime.
    SEED_ADMIN_EMAIL: z.string().optional(),
    SEED_ADMIN_NAME: z.string().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  // Client + shared vars must be listed so Next.js statically inlines them.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
