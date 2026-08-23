import "server-only";

/** Prefix every user avatar lives under (`avatars/<userId>`). */
export const AVATAR_PREFIX = "avatars/";

/**
 * Object stores have no directories — a "folder" is just a shared key prefix,
 * which means an empty one cannot exist. The admin explorer writes this
 * zero-byte marker object to hold a new folder open until something real lands
 * in it; the UI hides markers, and they go with the folder when it is deleted.
 */
export const FOLDER_MARKER = ".keep";

export function isFolderMarker(key: string): boolean {
  return key === FOLDER_MARKER || key.endsWith(`/${FOLDER_MARKER}`);
}

/**
 * Guards a storage key that came from a client. The browser screen round-trips
 * keys it listed, but the value still arrives over the wire: reject anything
 * absolute, traversing, control-charactered or absurdly long before it reaches
 * a backend (S3 would happily accept `../` as a literal key name, and the local
 * backend must never be handed a path that escapes its root).
 */
export function assertSafeStorageKey(key: string): void {
  const invalid =
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === ".." || segment === ".") ||
    Array.from(key).some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    });

  if (invalid) throw new Error("Invalid storage key.");
}

/**
 * Guards one path segment typed by an admin (a new folder, a rename). Unlike a
 * key, a name is a single segment: it may not contain a separator at all.
 */
export function assertValidEntryName(name: string): void {
  const invalid =
    !name ||
    name.length > 200 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    Array.from(name).some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    });

  if (invalid) {
    throw new Error(
      "Names cannot be empty, contain slashes, or use control characters.",
    );
  }
}

/** "" | "avatars" | "/avatars/" → "" | "avatars/" — the root is "". */
export function normalizeFolderPath(raw: string | undefined): string {
  const trimmed = (raw ?? "").replace(/^\/+/, "");
  if (!trimmed) return "";
  const path = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  assertSafeStorageKey(path);
  return path;
}
