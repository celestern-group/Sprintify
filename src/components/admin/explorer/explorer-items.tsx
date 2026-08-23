"use client";

import {
  IconArrowsMove,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDownload,
  IconEye,
  IconFolderFilled,
  IconInfoCircle,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import { ENTRY_DRAG_TYPE } from "./explorer-tree";
import {
  type ExplorerEntry,
  entryId,
  fileGlyph,
  formatDate,
  KIND_LABEL,
  tintClass,
  WELL_KNOWN_FOLDER,
} from "./explorer-utils";

export type SortKey = "name" | "size" | "modified" | "kind";
export type SortState = { key: SortKey; direction: "asc" | "desc" };
export type ExplorerView = "details" | "tiles" | "icons";

export type ItemsProps = {
  entries: ExplorerEntry[];
  view: ExplorerView;
  sort: SortState;
  onSort: (key: SortKey) => void;
  selection: string[];
  onSelect: (entry: ExplorerEntry, event: React.MouseEvent) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpen: (entry: ExplorerEntry) => void;
  renaming: string | null;
  onRename: (entry: ExplorerEntry) => void;
  onRenameSubmit: (entry: ExplorerEntry, name: string) => void;
  onRenameCancel: () => void;
  onDownload: (entry: ExplorerEntry) => void;
  onCopyKey: (entry: ExplorerEntry) => void;
  onMove: (entry: ExplorerEntry) => void;
  onDelete: (entry: ExplorerEntry) => void;
  onProperties: (entry: ExplorerEntry) => void;
  onDragEntries: (entry: ExplorerEntry, event: React.DragEvent) => void;
  onDropOnFolder: (target: string) => void;
};

function entryName(entry: ExplorerEntry): string {
  return entry.name;
}

/** Label under the name — what this object is, in one line. */
function entrySubtitle(entry: ExplorerEntry): string {
  if (entry.type === "folder") {
    return (
      WELL_KNOWN_FOLDER[entry.path] ??
      `${entry.fileCount} object${entry.fileCount === 1 ? "" : "s"}`
    );
  }
  return entry.ownerLabel ?? entry.contentType ?? KIND_LABEL[entry.kind];
}

function EntryIcon({
  entry,
  size,
}: {
  entry: ExplorerEntry;
  size: "sm" | "lg";
}) {
  const box = size === "sm" ? "size-8 rounded-md" : "size-12 rounded-lg";
  const glyph = size === "sm" ? "size-4" : "size-6";
  if (entry.type === "folder") {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          box,
          tintClass("folder"),
        )}
      >
        <IconFolderFilled className={glyph} />
      </span>
    );
  }
  const Glyph = fileGlyph(entry);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        box,
        tintClass(entry.kind),
      )}
    >
      <Glyph className={glyph} />
    </span>
  );
}

function KindCell({ entry }: { entry: ExplorerEntry }) {
  if (entry.type === "folder") return <Badge variant="outline">Folder</Badge>;
  if (entry.kind === "orphan") return <Badge variant="warning">Orphan</Badge>;
  if (entry.kind === "file") return <Badge variant="neutral">File</Badge>;
  return <Badge variant="secondary">{KIND_LABEL[entry.kind]}</Badge>;
}

function RenameField({
  entry,
  onSubmit,
  onCancel,
}: {
  entry: ExplorerEntry;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // Preselect the basename so typing replaces the name but keeps ".pdf".
    const dot = entry.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry.name]);

  return (
    <Input
      ref={ref}
      defaultValue={entry.name}
      aria-label={`Rename ${entry.name}`}
      className="h-7 w-full max-w-64 px-2 py-0 text-sm"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => onSubmit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onSubmit(event.currentTarget.value);
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

type MenuActions = {
  onOpen: (entry: ExplorerEntry) => void;
  onDownload: (entry: ExplorerEntry) => void;
  onRename: (entry: ExplorerEntry) => void;
  onDelete: (entry: ExplorerEntry) => void;
  onCopyKey: (entry: ExplorerEntry) => void;
  onMove: (entry: ExplorerEntry) => void;
  onProperties: (entry: ExplorerEntry) => void;
};

/**
 * Wraps a row or tile so right-clicking it opens that entry's menu.
 *
 * Declared at module scope on purpose: a component defined inside the render
 * body is a new type on every render, which remounts every row — and a row that
 * is replaced between two clicks never fires `dblclick`.
 */
function EntryMenu({
  entry,
  actions,
  children,
}: {
  entry: ExplorerEntry;
  actions: MenuActions;
  children: React.ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => actions.onOpen(entry)}>
          {entry.type === "folder" ? <IconFolderFilled /> : <IconEye />}
          {entry.type === "folder" ? "Open" : "Preview"}
        </ContextMenuItem>
        {entry.type === "file" ? (
          <ContextMenuItem onClick={() => actions.onDownload(entry)}>
            <IconDownload />
            Download
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onClick={() => actions.onCopyKey(entry)}>
          <IconCopy />
          Copy {entry.type === "folder" ? "prefix" : "key"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.onRename(entry)}>
          <IconPencil />
          Rename
          <span className="ml-auto text-xs text-muted-foreground">F2</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onMove(entry)}>
          <IconArrowsMove />
          Move to…
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onProperties(entry)}>
          <IconInfoCircle />
          Properties
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => actions.onDelete(entry)}
        >
          <IconTrash />
          Delete
          <span className="ml-auto text-xs text-muted-foreground">Del</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The content pane: one row (details) or tile per entry, with Explorer's
 * selection model — click selects, ctrl-click toggles, shift-click extends,
 * double-click opens, F2 renames, Delete deletes.
 */
export function ExplorerItems(props: ItemsProps) {
  const {
    entries,
    view,
    sort,
    onSort,
    selection,
    onSelect,
    onSelectAll,
    onClearSelection,
    onOpen,
    renaming,
    onRename,
    onRenameSubmit,
    onRenameCancel,
    onDelete,
    onDragEntries,
    onDropOnFolder,
  } = props;

  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const selected = new Set(selection);

  function keyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    const entry = entries[index];
    if (!entry) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(entry);
    } else if (event.key === "F2") {
      event.preventDefault();
      onRename(entry);
    } else if (event.key === "Delete") {
      event.preventDefault();
      onDelete(entry);
    } else if (event.key === "Escape") {
      onClearSelection();
    } else if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSelectAll();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = entries[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        document
          .querySelector<HTMLElement>(
            `[data-entry-id="${CSS.escape(entryId(next))}"]`,
          )
          ?.focus();
      }
    }
  }

  /** Shared wiring for a row or tile: selection, drag, drop, context menu. */
  function entryProps(entry: ExplorerEntry, index: number) {
    const id = entryId(entry);
    return {
      "data-entry-id": id,
      "data-state": selected.has(id) ? "selected" : undefined,
      tabIndex: 0,
      draggable: true,
      onClick: (event: React.MouseEvent) => onSelect(entry, event),
      onDoubleClick: () => onOpen(entry),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(event, index),
      onDragStart: (event: React.DragEvent) => onDragEntries(entry, event),
      onDragOver: (event: React.DragEvent) => {
        if (
          entry.type !== "folder" ||
          !event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)
        ) {
          return;
        }
        event.preventDefault();
        setDropTarget(entry.path);
      },
      onDragLeave: () => setDropTarget(null),
      onDrop: (event: React.DragEvent) => {
        if (
          entry.type !== "folder" ||
          !event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)
        ) {
          return;
        }
        event.preventDefault();
        setDropTarget(null);
        onDropOnFolder(entry.path);
      },
    };
  }

  /** Binds the module-level menu to this render's handlers. */
  const menuActions = {
    onOpen,
    onDownload: props.onDownload,
    onRename,
    onDelete,
    onCopyKey: props.onCopyKey,
    onMove: props.onMove,
    onProperties: props.onProperties,
  };

  if (view === "details") {
    const header = (key: SortKey, label: string, className?: string) => (
      <th
        className={cn(
          "h-9 px-3 text-left font-medium text-muted-foreground",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {label}
          {sort.key === key ? (
            sort.direction === "asc" ? (
              <IconChevronUp className="size-3.5" />
            ) : (
              <IconChevronDown className="size-3.5" />
            )
          ) : null}
        </button>
      </th>
    );

    return (
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {header("name", "Name")}
            {header("kind", "Kind", "hidden md:table-cell w-40")}
            {header("modified", "Date modified", "hidden sm:table-cell w-44")}
            {header("size", "Size", "w-28")}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <EntryMenu key={entryId(entry)} entry={entry} actions={menuActions}>
              <tr
                {...entryProps(entry, index)}
                className={cn(
                  "cursor-default select-none border-b border-border outline-none transition-colors last:border-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:bg-secondary",
                  dropTarget === entryId(entry) && "ring-2 ring-ring",
                )}
              >
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <EntryIcon entry={entry} size="sm" />
                    {renaming === entryId(entry) ? (
                      <RenameField
                        entry={entry}
                        onSubmit={(name) => onRenameSubmit(entry, name)}
                        onCancel={onRenameCancel}
                      />
                    ) : (
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {entryName(entry)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entrySubtitle(entry)}
                        </span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="hidden px-3 py-2 md:table-cell">
                  <KindCell entry={entry} />
                </td>
                <td className="hidden px-3 py-2 text-muted-foreground tabular-nums sm:table-cell">
                  {formatDate(entry.lastModified)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {entry.type === "folder"
                    ? formatBytes(entry.totalSize)
                    : formatBytes(entry.size)}
                </td>
              </tr>
            </EntryMenu>
          ))}
        </tbody>
      </table>
    );
  }

  const grid =
    view === "icons"
      ? "grid-cols-[repeat(auto-fill,minmax(112px,1fr))]"
      : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]";

  return (
    <div className={cn("grid gap-2 p-3", grid)}>
      {entries.map((entry, index) => (
        <EntryMenu key={entryId(entry)} entry={entry} actions={menuActions}>
          <div
            {...entryProps(entry, index)}
            className={cn(
              "flex cursor-default select-none rounded-md border border-transparent p-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:bg-secondary",
              view === "icons"
                ? "flex-col items-center gap-2 text-center"
                : "items-center gap-3",
              dropTarget === entryId(entry) && "ring-2 ring-ring",
            )}
          >
            <EntryIcon entry={entry} size="lg" />
            <div
              className={cn(
                "flex min-w-0 flex-col",
                view === "icons" && "w-full items-center",
              )}
            >
              {renaming === entryId(entry) ? (
                <RenameField
                  entry={entry}
                  onSubmit={(name) => onRenameSubmit(entry, name)}
                  onCancel={onRenameCancel}
                />
              ) : (
                <>
                  <span
                    className={cn(
                      "max-w-full truncate text-sm font-medium",
                      view === "icons" && "text-center",
                    )}
                  >
                    {entryName(entry)}
                  </span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">
                    {view === "icons"
                      ? entry.type === "folder"
                        ? `${entry.fileCount} items`
                        : formatBytes(entry.size)
                      : entrySubtitle(entry)}
                  </span>
                  {view === "tiles" ? (
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <KindCell entry={entry} />
                      {entry.type === "folder"
                        ? formatBytes(entry.totalSize)
                        : formatBytes(entry.size)}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </EntryMenu>
      ))}
    </div>
  );
}
