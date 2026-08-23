"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireAdminAction } from "@/lib/session";
import { storage } from "@/lib/storage";
import {
  AVATAR_PREFIX,
  assertSafeStorageKey,
  assertValidEntryName,
  FOLDER_MARKER,
  isFolderMarker,
  normalizeFolderPath,
} from "@/lib/storage/keys";

/**
 * The admin file explorer is a view of the object store itself — there is no
 * folder table behind it. Folders are the `/`-delimited prefixes present in the
 * keys, exactly as S3 reports them, plus the zero-byte marker objects this
 * screen writes so an empty folder can exist at all.
 */

/**
 * What a raw key turns out to be once matched against the database. The store
 * is the source of truth for what exists — only avatars have a row that can own
 * an object, so everything else is simply a `file`, and an `avatars/` key whose
 * user is gone is an `orphan`.
 */
export type ExplorerObjectKind = "file" | "avatar" | "orphan";

export type ExplorerFile = {
  type: "file";
  /** Full storage key. */
  key: string;
  /** Last key segment — the filename inside its folder. */
  name: string;
  size: number;
  lastModified: Date | null;
  kind: ExplorerObjectKind;
  /** Display name of the owning row — the user's name, on an avatar. */
  ownerLabel: string | null;
  /** Secondary line: the user's email, on an avatar. */
  ownerDetail: string | null;
  /**
   * MIME type, when something knows it. The store reports none in a listing, so
   * this is only set for keys whose shape implies it (avatars); the preview
   * pane falls back to the filename extension, and the download route reads the
   * type actually recorded with the bytes.
   */
  contentType: string | null;
};

export type ExplorerFolder = {
  type: "folder";
  /** The segment itself, e.g. `avatars`. */
  name: string;
  /** Full prefix, always trailing-slashed. */
  path: string;
  /** Objects anywhere below this prefix, markers excluded. */
  fileCount: number;
  totalSize: number;
  lastModified: Date | null;
};

export type ExplorerListing = {
  /** Normalized prefix that was read ("" for the root). */
  path: string;
  folders: ExplorerFolder[];
  files: ExplorerFile[];
  /** Bytes under this path, sub-folders included. */
  totalSize: number;
  /** True when the scan hit its cap — counts are then a lower bound. */
  truncated: boolean;
};

export type ExplorerTreeNode = {
  name: string;
  path: string;
  fileCount: number;
  children: ExplorerTreeNode[];
};

// Keys read per backend round-trip, and the ceiling for one call. Bulk writes
// are capped harder than reads: a mis-click must not fan out into thousands of
// irreversible deletes.
const SCAN_PAGE = 500;
const MAX_SCANNED_KEYS = 5000;
const MAX_BULK_KEYS = 500;

type RawObject = { key: string; size: number; lastModified: Date | null };

/** Every key under `prefix`, up to the scan cap. */
async function scan(
  prefix: string,
  cap = MAX_SCANNED_KEYS,
): Promise<{ objects: RawObject[]; truncated: boolean }> {
  const objects: RawObject[] = [];
  let cursor: string | null = null;
  let truncated = false;
  do {
    const page = await storage().list({
      prefix: prefix || undefined,
      cursor,
      limit: SCAN_PAGE,
    });
    objects.push(...page.objects);
    cursor = page.cursor;
    if (objects.length >= cap) {
      truncated = cursor !== null;
      break;
    }
  } while (cursor);
  return { objects, truncated };
}

/**
 * Matches keys against the rows that own them. Keys are matched, never trusted:
 * an `avatars/…` key whose user is gone is reported as an orphan, not as that
 * user's avatar. Nothing else in the store is owned by a row — the object IS
 * the record.
 */
async function annotate(
  objects: RawObject[],
  prefix: string,
): Promise<ExplorerFile[]> {
  const userIds = objects
    .map((object) => object.key)
    .filter((key) => key.startsWith(AVATAR_PREFIX))
    .map((key) => key.slice(AVATAR_PREFIX.length))
    // Avatars are one flat object per user; anything deeper isn't ours.
    .filter((id) => id.length > 0 && !id.includes("/"));

  const users = userIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const usersById = new Map(users.map((row) => [row.id, row]));

  return objects.map((object): ExplorerFile => {
    const base = {
      type: "file" as const,
      ...object,
      name: object.key.slice(prefix.length),
    };

    if (object.key.startsWith(AVATAR_PREFIX)) {
      const owner = usersById.get(object.key.slice(AVATAR_PREFIX.length));
      return owner
        ? {
            ...base,
            kind: "avatar",
            ownerLabel: owner.name,
            ownerDetail: owner.email,
            contentType: "image/*",
          }
        : {
            ...base,
            kind: "orphan",
            ownerLabel: null,
            ownerDetail: null,
            contentType: null,
          };
    }

    return {
      ...base,
      kind: "file",
      ownerLabel: null,
      ownerDetail: null,
      contentType: null,
    };
  });
}

const pathSchema = z.object({ path: z.string().trim().max(1024).optional() });

/**
 * One folder's contents: the immediate sub-prefixes (with what they add up to)
 * and the objects sitting directly under `path`.
 */
export async function readFolder(input: {
  path?: string;
}): Promise<ExplorerListing> {
  const parsed = pathSchema.parse(input);
  await requireAdminAction();

  const path = normalizeFolderPath(parsed.path);
  const { objects, truncated } = await scan(path);
  const visible = objects.filter((object) => !isFolderMarker(object.key));

  const direct = visible.filter(
    (object) => !object.key.slice(path.length).includes("/"),
  );
  const files = (await annotate(direct, path)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const folders = new Map<string, ExplorerFolder>();
  for (const object of objects) {
    const rest = object.key.slice(path.length);
    const slash = rest.indexOf("/");
    if (slash < 1) continue;
    const name = rest.slice(0, slash);
    const folder = folders.get(name) ?? {
      type: "folder" as const,
      name,
      path: `${path}${name}/`,
      fileCount: 0,
      totalSize: 0,
      lastModified: null,
    };
    // Marker objects hold a folder open but are not contents.
    if (!isFolderMarker(object.key)) {
      folder.fileCount += 1;
      folder.totalSize += object.size;
      if (
        object.lastModified &&
        (!folder.lastModified || object.lastModified > folder.lastModified)
      ) {
        folder.lastModified = object.lastModified;
      }
    }
    folders.set(name, folder);
  }

  return {
    path,
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files,
    totalSize: visible.reduce((sum, object) => sum + object.size, 0),
    truncated,
  };
}

/**
 * The whole folder hierarchy, for the navigation pane. Built from one capped
 * scan of the key space — the store is flat, so there is nothing cheaper to
 * ask it for.
 */
export async function readTree(): Promise<ExplorerTreeNode[]> {
  await requireAdminAction();
  const { objects } = await scan("");

  const roots: ExplorerTreeNode[] = [];
  const byPath = new Map<string, ExplorerTreeNode>();

  for (const object of objects) {
    const segments = object.key.split("/");
    // The last segment is the object itself, not a folder.
    segments.pop();
    let parentPath = "";
    for (const segment of segments) {
      const path = `${parentPath}${segment}/`;
      let node = byPath.get(path);
      if (!node) {
        node = { name: segment, path, fileCount: 0, children: [] };
        byPath.set(path, node);
        const parent = parentPath ? byPath.get(parentPath) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      if (!isFolderMarker(object.key)) node.fileCount += 1;
      parentPath = path;
    }
  }

  const sort = (nodes: ExplorerTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}

const createFolderSchema = z.object({
  path: z.string().trim().max(1024).optional(),
  name: z.string().trim().min(1).max(200),
});

/**
 * Creates a folder by writing the zero-byte marker object that keeps an
 * otherwise-empty prefix visible. Nothing else in the store changes: the moment
 * the folder holds a real object the marker is redundant, and deleting the
 * folder removes it again.
 */
export async function createFolder(input: { path?: string; name: string }) {
  const parsed = createFolderSchema.parse(input);
  const session = await requireAdminAction();

  const path = normalizeFolderPath(parsed.path);
  assertValidEntryName(parsed.name);
  const target = `${path}${parsed.name}/`;
  assertSafeStorageKey(target);

  const existing = await storage().list({ prefix: target, limit: 1 });
  if (existing.objects.length > 0) {
    throw new Error(`"${parsed.name}" already exists here.`);
  }

  await storage().put(
    `${target}${FOLDER_MARKER}`,
    new Uint8Array(),
    "application/x-directory",
  );

  await recordAudit({
    action: "storage_folder.created",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "storage_folder",
    targetId: target,
    metadata: { parent: path || "/" },
  });

  revalidatePath("/admin/files", "page");
  return { path: target };
}

/**
 * Moves one object. The store has no rename, so this is a server-side copy
 * followed by a delete of the original.
 */
async function moveObject(fromKey: string, toKey: string) {
  if (fromKey === toKey) return;

  if (fromKey.startsWith(AVATAR_PREFIX)) {
    const userId = fromKey.slice(AVATAR_PREFIX.length);
    const [owner] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    // An avatar is addressed by its user's id, not by a stored key — moving it
    // would silently detach the picture, so refuse rather than break it.
    if (owner) {
      throw new Error(
        "Avatars are addressed by user id — move or rename would detach the picture.",
      );
    }
  }

  const collision = await storage().get(toKey);
  if (collision) throw new Error(`"${toKey}" already exists.`);

  await storage().copy(fromKey, toKey);
  await storage().delete(fromKey);
}

const renameSchema = z.object({
  key: z.string().trim().min(1).max(1024),
  name: z.string().trim().min(1).max(200),
  isFolder: z.boolean(),
});

/** Renames one file, or one folder and everything under it. */
export async function renameEntry(input: {
  key: string;
  name: string;
  isFolder: boolean;
}) {
  const parsed = renameSchema.parse(input);
  const session = await requireAdminAction();
  assertValidEntryName(parsed.name);

  if (parsed.isFolder) {
    const from = normalizeFolderPath(parsed.key);
    if (!from) throw new Error("The storage root cannot be renamed.");
    const parent = from.slice(0, from.lastIndexOf("/", from.length - 2) + 1);
    const to = `${parent}${parsed.name}/`;
    assertSafeStorageKey(to);
    if (to === from) return { path: to };

    const { objects, truncated } = await scan(from, MAX_BULK_KEYS);
    if (truncated) {
      throw new Error(
        `This folder holds more than ${MAX_BULK_KEYS} objects — rename it in the store directly.`,
      );
    }
    for (const object of objects) {
      await moveObject(object.key, `${to}${object.key.slice(from.length)}`);
    }

    await recordAudit({
      action: "storage_folder.renamed",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "storage_folder",
      targetId: from,
      metadata: { to, objects: objects.length },
    });

    revalidatePath("/admin/files", "page");
    return { path: to };
  }

  assertSafeStorageKey(parsed.key);
  const parent = parsed.key.slice(0, parsed.key.lastIndexOf("/") + 1);
  const to = `${parent}${parsed.name}`;
  assertSafeStorageKey(to);
  await moveObject(parsed.key, to);

  await recordAudit({
    action: "storage_object.renamed",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "storage_object",
    targetId: parsed.key,
    metadata: { to },
  });

  revalidatePath("/admin/files", "page");
  return { path: to };
}

const moveSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(1024)).max(MAX_BULK_KEYS),
  folders: z.array(z.string().trim().min(1).max(1024)).max(50),
  target: z.string().trim().max(1024).optional(),
});

/** Moves any mix of files and folders into `target`. */
export async function moveEntries(input: {
  keys: string[];
  folders: string[];
  target?: string;
}) {
  const parsed = moveSchema.parse(input);
  const session = await requireAdminAction();

  const target = normalizeFolderPath(parsed.target);
  let moved = 0;

  for (const key of parsed.keys) {
    assertSafeStorageKey(key);
    const name = key.slice(key.lastIndexOf("/") + 1);
    await moveObject(key, `${target}${name}`);
    moved += 1;
  }

  for (const raw of parsed.folders) {
    const from = normalizeFolderPath(raw);
    if (!from) continue;
    const name = from.slice(0, -1).split("/").pop() ?? "";
    const to = `${target}${name}/`;
    // Dropping a folder inside itself would recurse forever.
    if (to === from || to.startsWith(from)) {
      throw new Error(`"${name}" cannot be moved into itself.`);
    }
    const { objects, truncated } = await scan(from, MAX_BULK_KEYS);
    if (truncated) {
      throw new Error(
        `"${name}" holds more than ${MAX_BULK_KEYS} objects — move it in the store directly.`,
      );
    }
    for (const object of objects) {
      await moveObject(object.key, `${to}${object.key.slice(from.length)}`);
      moved += 1;
    }
  }

  await recordAudit({
    action: "storage_object.moved",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "storage_path",
    targetId: target || "/",
    metadata: {
      objects: moved,
      files: parsed.keys.length,
      folders: parsed.folders.length,
    },
  });

  revalidatePath("/admin/files", "page");
  return { moved };
}

/**
 * Deletes one object, and clears the only pointer any row can hold into the
 * store: a user's `image` when their avatar bytes are removed. Everything else
 * is unreferenced by construction.
 */
async function deleteObject(key: string): Promise<ExplorerObjectKind> {
  let kind: ExplorerObjectKind = "file";

  if (key.startsWith(AVATAR_PREFIX)) {
    const userId = key.slice(AVATAR_PREFIX.length);
    const [owner] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (owner) {
      kind = "avatar";
      await db.update(user).set({ image: null }).where(eq(user.id, owner.id));
    } else {
      kind = "orphan";
    }
  }

  await storage().delete(key);
  return kind;
}

const deleteSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(1024)).max(MAX_BULK_KEYS),
  folders: z.array(z.string().trim().min(1).max(1024)).max(50),
});

/**
 * Deletes files and/or whole folders. Destructive and irreversible — there is
 * no soft delete in an object store.
 */
export async function deleteEntries(input: {
  keys: string[];
  folders: string[];
}) {
  const parsed = deleteSchema.parse(input);
  const session = await requireAdminAction();

  let deleted = 0;

  for (const key of parsed.keys) {
    assertSafeStorageKey(key);
    await deleteObject(key);
    deleted += 1;
  }

  for (const raw of parsed.folders) {
    const path = normalizeFolderPath(raw);
    if (!path) throw new Error("The storage root cannot be deleted.");
    const { objects, truncated } = await scan(path, MAX_BULK_KEYS);
    if (truncated) {
      throw new Error(
        `"${path}" holds more than ${MAX_BULK_KEYS} objects — delete it in the store directly.`,
      );
    }
    for (const object of objects) {
      await deleteObject(object.key);
      deleted += 1;
    }
  }

  await recordAudit({
    action: "storage_object.deleted",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "storage_path",
    targetId: parsed.folders[0] ?? parsed.keys[0] ?? "/",
    metadata: {
      objects: deleted,
      files: parsed.keys.length,
      folders: parsed.folders.length,
    },
  });

  revalidatePath("/admin/files", "page");
  return { deleted };
}
