import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Symmetric encryption for third-party secrets we must be able to read back
 * (provider API keys). Passwords are hashed by Better Auth and never come
 * through here.
 *
 * Envelope: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. AES-256-GCM
 * with a fresh 12-byte IV per write, and the scope string bound in as
 * additional authenticated data so a ciphertext copied from one row into
 * another (platform → org, or org → org) fails to decrypt instead of silently
 * leaking a key across tenants.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Which config row a ciphertext belongs to. Bound as GCM additional
 * authenticated data — decryption must be given the same scope it was
 * encrypted under.
 */
export type SecretScope = "platform" | `org:${string}`;

/**
 * Accepts the three forms an operator plausibly reaches for, in order of
 * decreasing specificity: 64 hex characters, base64 that decodes to 32 bytes,
 * or a literal 32-character passphrase. Hex is tried first because a hex string
 * is also valid base64 and would otherwise decode to the wrong length silently.
 */
function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === KEY_BYTES) return decoded;

  const literal = Buffer.from(trimmed, "utf8");
  if (literal.length === KEY_BYTES) return literal;

  throw new Error(
    `AI_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, base64 of 32 bytes (openssl rand -base64 32), or a literal 32-character string. Got ${trimmed.length} characters.`,
  );
}

// Resolved on first use rather than at import time, matching the lazy backend
// in src/lib/storage/index.ts — an app that never configures AI must not be
// forced to set this var.
let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.AI_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "AI_ENCRYPTION_KEY is not set, so provider API keys cannot be stored. Generate one with `openssl rand -base64 32` and add it to your environment.",
    );
  }

  cachedKey = parseKey(raw);
  return cachedKey;
}

/** True when a key is configured — lets callers show a setup hint instead of throwing. */
export function isSecretStorageConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

const b64 = (buffer: Buffer) => buffer.toString("base64url");

export function encryptSecret(plaintext: string, scope: SecretScope): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(scope, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return `${VERSION}.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ciphertext)}`;
}

export function decryptSecret(payload: string, scope: SecretScope): string {
  const [version, iv, authTag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !authTag || !ciphertext) {
    throw new Error("Stored secret is malformed or uses an unknown format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(scope, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  // Throws when the tag doesn't verify: wrong key (rotated AI_ENCRYPTION_KEY),
  // tampered ciphertext, or a row copied across scopes.
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The only representation of a secret that may reach a client: the last four
 * characters behind bullets. Short secrets are fully masked.
 */
export function secretHint(plaintext: string): string {
  const value = plaintext.trim();
  return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}

/** Constant-time compare, for confirming a re-entered secret matches. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
