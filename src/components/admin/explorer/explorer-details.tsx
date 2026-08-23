"use client";

import { IconFolderFilled } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import { PreviewSurface } from "./explorer-preview";
import {
  type ExplorerEntry,
  fileGlyph,
  formatDate,
  KIND_LABEL,
  previewKind,
  tintClass,
  WELL_KNOWN_FOLDER,
} from "./explorer-utils";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-xs wrap-break-word">{value}</span>
    </div>
  );
}

/**
 * Properties pane — Explorer's details panel. Shows what the store knows about
 * the selection, plus what the database says owns it.
 */
export function ExplorerDetails({
  path,
  selection,
  folderCount,
  fileCount,
  totalSize,
}: {
  path: string;
  selection: ExplorerEntry[];
  folderCount: number;
  fileCount: number;
  totalSize: number;
}) {
  if (selection.length > 1) {
    const bytes = selection.reduce(
      (sum, entry) =>
        sum + (entry.type === "folder" ? entry.totalSize : entry.size),
      0,
    );
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-heading text-sm font-semibold">
          {selection.length} items selected
        </h2>
        <div className="divide-y divide-border">
          <Row
            label="Folders"
            value={selection.filter((entry) => entry.type === "folder").length}
          />
          <Row
            label="Files"
            value={selection.filter((entry) => entry.type === "file").length}
          />
          <Row label="Total size" value={formatBytes(bytes)} />
        </div>
      </div>
    );
  }

  const entry = selection[0];

  if (!entry) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-heading text-sm font-semibold">
          {path
            ? (path.split("/").filter(Boolean).pop() ?? "")
            : "Storage root"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {WELL_KNOWN_FOLDER[path] ??
            "Select an item to see what the store and the database know about it."}
        </p>
        <div className="divide-y divide-border">
          <Row
            label="Path"
            value={<span className="font-mono">{path || "/"}</span>}
          />
          <Row label="Folders" value={folderCount} />
          <Row label="Files" value={fileCount} />
          <Row label="Size" value={formatBytes(totalSize)} />
        </div>
      </div>
    );
  }

  const Glyph = entry.type === "folder" ? IconFolderFilled : fileGlyph(entry);
  const previewable = entry.type === "file" && previewKind(entry) !== null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {entry.type === "file" && previewable ? (
          <div className="w-full">
            <PreviewSurface file={entry} size="pane" />
          </div>
        ) : (
          <span
            className={cn(
              "flex size-14 items-center justify-center rounded-lg",
              tintClass(entry.type === "folder" ? "folder" : entry.kind),
            )}
          >
            <Glyph className="size-7" />
          </span>
        )}
        <span className="w-full truncate font-heading text-sm font-semibold">
          {entry.name}
        </span>
        {entry.type === "folder" ? (
          <Badge variant="outline">Folder</Badge>
        ) : (
          <Badge variant={entry.kind === "orphan" ? "warning" : "secondary"}>
            {KIND_LABEL[entry.kind]}
          </Badge>
        )}
      </div>

      <div className="divide-y divide-border">
        {entry.type === "folder" ? (
          <>
            <Row
              label="Prefix"
              value={<span className="font-mono">{entry.path}</span>}
            />
            <Row label="Objects" value={entry.fileCount} />
            <Row label="Size" value={formatBytes(entry.totalSize)} />
            <Row label="Newest" value={formatDate(entry.lastModified)} />
          </>
        ) : (
          <>
            <Row
              label="Key"
              value={<span className="font-mono">{entry.key}</span>}
            />
            <Row label="Size" value={formatBytes(entry.size)} />
            <Row label="Modified" value={formatDate(entry.lastModified)} />
            <Row label="Type" value={entry.contentType ?? "Unknown"} />
            <Row
              label="Owner"
              value={
                entry.ownerLabel ? (
                  <span className="flex flex-col">
                    <span>{entry.ownerLabel}</span>
                    {entry.ownerDetail ? (
                      <span className="text-muted-foreground">
                        {entry.ownerDetail}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Nothing in the database references this object.
                  </span>
                )
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
