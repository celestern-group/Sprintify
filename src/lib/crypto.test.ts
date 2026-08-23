import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Must be set before the module reads it (the key is cached on first use).
process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

let encryptSecret: typeof import("./crypto").encryptSecret;
let decryptSecret: typeof import("./crypto").decryptSecret;
let secretHint: typeof import("./crypto").secretHint;
let isSecretStorageConfigured: typeof import("./crypto").isSecretStorageConfigured;

beforeAll(async () => {
  ({ encryptSecret, decryptSecret, secretHint, isSecretStorageConfigured } =
    await import("./crypto"));
});

const SECRET_SAMPLE = "sample value used only for encryption tests";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret within the same scope", () => {
    expect(
      decryptSecret(encryptSecret(SECRET_SAMPLE, "platform"), "platform"),
    ).toBe(SECRET_SAMPLE);
    expect(
      decryptSecret(encryptSecret(SECRET_SAMPLE, "org:abc"), "org:abc"),
    ).toBe(SECRET_SAMPLE);
  });

  it("produces a versioned four-part envelope", () => {
    const parts = encryptSecret(SECRET_SAMPLE, "platform").split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("never emits the plaintext", () => {
    expect(encryptSecret(SECRET_SAMPLE, "platform")).not.toContain(
      SECRET_SAMPLE,
    );
  });

  it("uses a fresh IV per write, so the same input encrypts differently", () => {
    expect(encryptSecret(SECRET_SAMPLE, "platform")).not.toBe(
      encryptSecret(SECRET_SAMPLE, "platform"),
    );
  });

  it("rejects a ciphertext moved to a different scope", () => {
    const payload = encryptSecret(SECRET_SAMPLE, "org:tenant-a");
    expect(() => decryptSecret(payload, "org:tenant-b")).toThrow();
    expect(() => decryptSecret(payload, "platform")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const [version, iv, tag, ciphertext] = encryptSecret(
      SECRET_SAMPLE,
      "platform",
    ).split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptSecret(
        `${version}.${iv}.${tag}.${flipped.toString("base64url")}`,
        "platform",
      ),
    ).toThrow();
  });

  it("rejects an unknown envelope version", () => {
    const payload = encryptSecret(SECRET_SAMPLE, "platform").replace(
      "v1.",
      "v2.",
    );
    expect(() => decryptSecret(payload, "platform")).toThrow(
      /malformed or uses an unknown format/,
    );
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-payload", "platform")).toThrow(
      /malformed or uses an unknown format/,
    );
  });

  it("reports that storage is configured", () => {
    expect(isSecretStorageConfigured()).toBe(true);
  });
});

// The key is read once and cached, so each accepted form needs its own fresh
// module instance.
describe("AI_ENCRYPTION_KEY formats", () => {
  async function withKey(value: string) {
    vi.resetModules();
    process.env.AI_ENCRYPTION_KEY = value;
    return import("./crypto");
  }

  afterEach(() => {
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("accepts base64 of 32 bytes", async () => {
    const mod = await withKey(Buffer.alloc(32, 3).toString("base64"));
    expect(
      mod.decryptSecret(
        mod.encryptSecret(SECRET_SAMPLE, "platform"),
        "platform",
      ),
    ).toBe(SECRET_SAMPLE);
  });

  it("accepts 64 hex characters", async () => {
    const mod = await withKey("a".repeat(64));
    expect(
      mod.decryptSecret(
        mod.encryptSecret(SECRET_SAMPLE, "platform"),
        "platform",
      ),
    ).toBe(SECRET_SAMPLE);
  });

  it("accepts a literal 32-character passphrase", async () => {
    const mod = await withKey("0123456789abcdefghijklmnopqrstuv");
    expect(
      mod.decryptSecret(
        mod.encryptSecret(SECRET_SAMPLE, "platform"),
        "platform",
      ),
    ).toBe(SECRET_SAMPLE);
  });

  it("rejects a key of the wrong length with an actionable message", async () => {
    const mod = await withKey("too-short");
    expect(() => mod.encryptSecret(SECRET_SAMPLE, "platform")).toThrow(
      /must be 32 bytes.*Got 9 characters/,
    );
  });

  it("reports storage as unconfigured when the var is missing", async () => {
    vi.resetModules();
    // Must be absent, not the string "undefined".
    delete process.env.AI_ENCRYPTION_KEY;
    const mod = await import("./crypto");
    expect(mod.isSecretStorageConfigured()).toBe(false);
    expect(() => mod.encryptSecret(SECRET_SAMPLE, "platform")).toThrow(
      /AI_ENCRYPTION_KEY is not set/,
    );
  });
});

describe("secretHint", () => {
  it("keeps only the last four characters", () => {
    expect(secretHint(SECRET_SAMPLE)).toBe("••••ests");
  });

  it("fully masks short secrets", () => {
    expect(secretHint("short")).toBe("••••");
    expect(secretHint("12345678")).toBe("••••");
  });
});
