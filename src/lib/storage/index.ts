import "server-only";
import { LocalStorageBackend } from "./local";
import { S3StorageBackend } from "./s3";
import type { StorageBackend } from "./types";

export type { StorageBackend, StoredObject } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required storage env var: ${name}`);
  }
  return value;
}

function createBackend(): StorageBackend {
  const backend = (process.env.STORAGE_BACKEND ?? "local").toLowerCase();

  switch (backend) {
    case "s3":
      return new S3StorageBackend({
        bucket: requireEnv("STORAGE_S3_BUCKET"),
        region: requireEnv("STORAGE_S3_REGION"),
        accessKeyId: requireEnv("STORAGE_S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("STORAGE_S3_SECRET_ACCESS_KEY"),
        endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
      });
    case "local":
      return new LocalStorageBackend(
        process.env.STORAGE_LOCAL_PATH ?? ".storage",
      );
    default:
      throw new Error(
        `Unknown STORAGE_BACKEND: "${backend}" (expected "local" or "s3")`,
      );
  }
}

// Lazily instantiate a single backend for the process, so a missing/invalid
// env var fails on first use with a clear message rather than at import time.
let cached: StorageBackend | null = null;

export function storage(): StorageBackend {
  if (!cached) cached = createBackend();
  return cached;
}
