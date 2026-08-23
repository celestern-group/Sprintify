import type { Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";
import type { StorageBackend, StorageListPage, StoredObject } from "./types";

// Sidecar file that records the content type alongside the bytes, so `get`
// can report it back without sniffing.
const TYPE_SUFFIX = ".type";

/**
 * Filesystem-backed storage. Everything lives under a single root directory
 * (`STORAGE_LOCAL_PATH`). Keys are resolved relative to that root and validated
 * to prevent path traversal outside it.
 */
export class LocalStorageBackend implements StorageBackend {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolveKey(key: string) {
    // Reject absolute keys and anything that escapes the root via `..`.
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    await writeFile(`${target}${TYPE_SUFFIX}`, contentType, "utf8");
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = this.resolveKey(key);
    let body: Uint8Array;
    try {
      body = new Uint8Array(await readFile(target));
    } catch {
      return null;
    }
    let contentType: string | undefined;
    try {
      contentType =
        (await readFile(`${target}${TYPE_SUFFIX}`, "utf8")) || undefined;
    } catch {
      contentType = undefined;
    }
    return { body, contentType };
  }

  async delete(key: string) {
    const target = this.resolveKey(key);
    await rm(target, { force: true });
    await rm(`${target}${TYPE_SUFFIX}`, { force: true });
  }

  async copy(fromKey: string, toKey: string) {
    const from = this.resolveKey(fromKey);
    const to = this.resolveKey(toKey);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    // The sidecar is optional — an object written before it existed, or by
    // hand, simply has no recorded content type to carry over.
    await copyFile(`${from}${TYPE_SUFFIX}`, `${to}${TYPE_SUFFIX}`).catch(
      () => {},
    );
  }

  async list(options?: {
    prefix?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<StorageListPage> {
    const limit = options?.limit ?? 50;
    const prefix = options?.prefix ?? "";

    let entries: Dirent[];
    try {
      entries = await readdir(this.root, {
        recursive: true,
        withFileTypes: true,
      });
    } catch {
      // Nothing has ever been written to this root yet.
      return { objects: [], cursor: null };
    }

    const keys = entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(TYPE_SUFFIX))
      .map((entry) => {
        const absolute = resolve(entry.parentPath, entry.name);
        return absolute
          .slice(this.root.length + 1)
          .split(sep)
          .join("/");
      })
      .filter((key) => key.startsWith(prefix))
      // The cursor is the last key of the previous page — same "start after"
      // semantics as S3's continuation token, so both backends paginate alike.
      .filter((key) => !options?.cursor || key > options.cursor)
      .sort();

    const page = keys.slice(0, limit);
    const objects = await Promise.all(
      page.map(async (key) => {
        const stats = await stat(this.resolveKey(key)).catch(() => null);
        return {
          key,
          size: stats?.size ?? 0,
          lastModified: stats?.mtime ?? null,
        };
      }),
    );

    return {
      objects,
      cursor: keys.length > limit ? (page.at(-1) ?? null) : null,
    };
  }
}
