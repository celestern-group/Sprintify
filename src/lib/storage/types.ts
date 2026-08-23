export type StoredObject = {
  /** Raw bytes of the object. */
  body: Uint8Array;
  /** MIME type the object was stored with, if known. */
  contentType?: string;
};

/** One entry of a `list()` page — metadata only, never the bytes. */
export type StorageObjectSummary = {
  key: string;
  size: number;
  lastModified: Date | null;
};

export type StorageListPage = {
  objects: StorageObjectSummary[];
  /** Opaque token for the next page, or null when this is the last one. */
  cursor: string | null;
};

/**
 * Minimal object-storage contract shared by every backend (local disk, S3, …).
 *
 * Keys are opaque, forward-slash-delimited paths (e.g. `avatars/<userId>/<id>.png`).
 * Callers never see where the bytes physically live — that is the whole point:
 * credentials and bucket/endpoint details stay server-side, and objects are
 * only ever reachable through our own authenticated routes.
 */
export interface StorageBackend {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Returns `null` when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Idempotent — deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Server-side copy of one object. Used by the admin file explorer to move and
   * rename objects (the store has no rename — a move is copy-then-delete), so
   * the bytes never round-trip through the app.
   */
  copy(fromKey: string, toKey: string): Promise<void>;
  /**
   * One page of stored keys, ascending, optionally narrowed to a prefix. Only
   * the platform-admin storage browser uses this: ordinary features address
   * objects by a key they already know, never by scanning the store.
   */
  list(options?: {
    prefix?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<StorageListPage>;
}
