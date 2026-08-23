import {
  IconFile,
  IconFileCode,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileUnknown,
  IconFileZip,
  IconMusic,
  IconPhoto,
  IconVideo,
} from "@tabler/icons-react";
import type {
  ExplorerFile,
  ExplorerFolder,
  ExplorerObjectKind,
} from "@/lib/actions/admin-explorer";

export type { ExplorerFile };

export type ExplorerEntry = ExplorerFolder | ExplorerFile;

/** Stable identity for selection: a folder is its path, a file is its key. */
export function entryId(entry: ExplorerEntry): string {
  return entry.type === "folder" ? entry.path : entry.key;
}

export const KIND_LABEL: Record<ExplorerObjectKind, string> = {
  file: "File",
  avatar: "User avatar",
  orphan: "Orphan",
};

/** Well-known prefixes the platform writes to, named for humans. */
export const WELL_KNOWN_FOLDER: Record<string, string> = {
  "avatars/": "Profile pictures",
};

export function downloadHref(key: string): string {
  return `/api/admin/storage?key=${encodeURIComponent(key)}`;
}

/** Same object, rendered in the browser instead of downloaded. */
export function previewHref(key: string): string {
  return `${downloadHref(key)}&inline=1`;
}

export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video";

/**
 * What the preview pane can render for this object, or null when it can only
 * be downloaded. Mirrors the API route's inline whitelist — script-bearing
 * types (SVG, HTML) are deliberately absent, since the route refuses to serve
 * them inline and the preview must not promise what it cannot show.
 */
export function previewKind(file: ExplorerFile): PreviewKind | null {
  const declared = (file.contentType ?? "").split(";")[0]?.trim().toLowerCase();
  const type =
    declared &&
    declared !== "application/octet-stream" &&
    declared !== "image/*"
      ? declared
      : "";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  // Avatars are stored as images but recorded as the wildcard `image/*`.
  if (file.kind === "avatar") return "image";
  if (type.startsWith("image/"))
    return type === "image/svg+xml" ? null : "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (
    type === "text/plain" ||
    type === "text/csv" ||
    type === "text/markdown" ||
    type === "application/json"
  ) {
    return "text";
  }

  if (
    ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"].includes(
      extension,
    )
  )
    return "image";
  if (extension === "pdf") return "pdf";
  if (["mp3", "wav", "ogg"].includes(extension)) return "audio";
  if (["mp4", "webm"].includes(extension)) return "video";
  if (["txt", "log", "md", "csv", "json"].includes(extension)) return "text";
  return null;
}

export function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Glyph for a stored object. A listing carries no MIME type for an ordinary
 * file, so the filename extension does most of the work and the type only
 * leads where something knows it (avatars).
 */
export function fileGlyph(file: ExplorerFile) {
  const type = file.contentType ?? "";
  if (type.startsWith("image/")) return IconPhoto;
  if (type.startsWith("video/")) return IconVideo;
  if (type.startsWith("audio/")) return IconMusic;
  if (type === "application/pdf") return IconFileTypePdf;
  if (/zip|compressed|tar|gzip|x-7z/.test(type)) return IconFileZip;
  if (/csv|spreadsheet|excel/.test(type)) return IconFileSpreadsheet;
  if (/json|xml|javascript|typescript/.test(type)) return IconFileCode;
  if (type.startsWith("text/")) return IconFileText;

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension))
    return IconPhoto;
  if (["mp4", "mov", "webm", "mkv"].includes(extension)) return IconVideo;
  if (["mp3", "wav", "ogg", "flac"].includes(extension)) return IconMusic;
  if (extension === "pdf") return IconFileTypePdf;
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension)) return IconFileZip;
  if (["csv", "xlsx", "xls"].includes(extension)) return IconFileSpreadsheet;
  if (["json", "xml", "yml", "yaml", "ts", "js"].includes(extension))
    return IconFileCode;
  if (["txt", "md", "log"].includes(extension)) return IconFileText;

  return file.kind === "orphan" ? IconFileUnknown : IconFile;
}

/**
 * Icon tint carries the object's standing, never its file type — violet stays
 * the single accent, amber flags bytes nothing owns.
 */
export function tintClass(kind: ExplorerObjectKind | "folder"): string {
  if (kind === "orphan") return "bg-chip text-warning";
  return "bg-secondary text-secondary-foreground";
}

/** Address-bar segments for a path, each with the path that reaches it. */
export function pathSegments(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: `${parts.slice(0, index + 1).join("/")}/`,
  }));
}

/** The folder holding `path` ("" when it is already a top-level folder). */
export function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}
