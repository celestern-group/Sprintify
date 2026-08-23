"use client";

import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconChevronRight,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconFolderPlus,
  IconInfoCircle,
  IconLayoutGrid,
  IconLayoutList,
  IconList,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconServer,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  usePersistedChoice,
  usePersistedState,
} from "@/hooks/use-persisted-state";
import {
  createFolder,
  deleteEntries,
  type ExplorerListing,
  type ExplorerTreeNode,
  moveEntries,
  readFolder,
  readTree,
  renameEntry,
} from "@/lib/actions/admin-explorer";
import { formatBytes } from "@/lib/format-bytes";
import { MAX_UPLOADS_PER_REQUEST } from "@/lib/storage/upload-limits";
import { cn } from "@/lib/utils";
import { batchedForUpload } from "@/lib/work-item-attachments";
import { ExplorerDetails } from "./explorer-details";
import {
  ExplorerItems,
  type ExplorerView,
  type SortKey,
  type SortState,
} from "./explorer-items";
import { PreviewDialog } from "./explorer-preview";
import { ENTRY_DRAG_TYPE, ExplorerTree } from "./explorer-tree";
import {
  downloadHref,
  type ExplorerEntry,
  type ExplorerFile,
  entryId,
  parentPath,
  pathSegments,
  previewKind,
} from "./explorer-utils";

const EXPLORER_VIEWS: readonly ExplorerView[] = ["details", "tiles", "icons"];
const SORT_KEYS: readonly SortKey[] = ["name", "size", "modified", "kind"];
const DEFAULT_SORT: SortState = { key: "name", direction: "asc" };

/** A stored sort is two closed sets — anything else falls back to name/asc. */
function reviveSortState(raw: unknown): SortState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { key, direction } = raw as { key?: unknown; direction?: unknown };
  if (
    typeof key !== "string" ||
    !(SORT_KEYS as readonly string[]).includes(key)
  )
    return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { key: key as SortKey, direction };
}

/** Flattens the tree into "move to" targets, deepest paths last. */
function flattenTree(
  nodes: ExplorerTreeNode[],
  depth = 0,
): { path: string; name: string; depth: number }[] {
  return nodes.flatMap((node) => [
    { path: node.path, name: node.name, depth },
    ...flattenTree(node.children, depth + 1),
  ]);
}

type DialogState =
  | { kind: "new-folder" }
  | { kind: "move"; entries: ExplorerEntry[] }
  | { kind: "delete"; entries: ExplorerEntry[] }
  | null;

/**
 * Platform-admin file explorer over the object store.
 *
 * This is a view of the store itself — S3 (or the local backend) is the source
 * of truth, and there is no folder table behind it: folders are the `/`-
 * delimited prefixes in the keys. The database only annotates what it owns, so
 * bytes nothing references still show up, which is the point of the screen.
 */
export function FileExplorer() {
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const path = history[historyIndex] ?? "";

  const [listing, setListing] = useState<ExplorerListing | null>(null);
  const [tree, setTree] = useState<ExplorerTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // View mode and sort are per-user habits, like Explorer's — remembered
  // locally, and now under the shared preference scope so two admins on one
  // machine don't inherit each other's.
  const [view, setView] = usePersistedChoice<ExplorerView>(
    "explorer.view",
    "details",
    EXPLORER_VIEWS,
  );
  const [sort, setSort] = usePersistedState<SortState>(
    "explorer.sort",
    DEFAULT_SORT,
    reviveSortState,
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [preview, setPreview] = useState<ExplorerFile | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [folder, nodes] = await Promise.all([
        readFolder({ path }),
        readTree(),
      ]);
      setListing(folder);
      setTree(nodes);
    } catch (loadError) {
      setListing(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to read the object store.",
      );
    }
    setLoading(false);
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  function navigate(next: string) {
    setSelection([]);
    setAnchor(null);
    setRenaming(null);
    setQuery("");
    setTreeOpen(false);
    setHistory((current) => [...current.slice(0, historyIndex + 1), next]);
    setHistoryIndex((current) => current + 1);
  }

  const entries: ExplorerEntry[] = (() => {
    if (!listing) return [];
    const needle = query.trim().toLowerCase();
    const all: ExplorerEntry[] = [...listing.folders, ...listing.files];
    const filtered = needle
      ? all.filter((entry) =>
          [
            entry.name,
            entry.type === "file" ? entry.ownerLabel : null,
            entry.type === "file" ? entry.ownerDetail : null,
          ].some((value) => value?.toLowerCase().includes(needle)),
        )
      : all;

    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Folders lead, exactly like Explorer, whatever the sort column is.
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      switch (sort.key) {
        case "size": {
          const sizeA = a.type === "folder" ? a.totalSize : a.size;
          const sizeB = b.type === "folder" ? b.totalSize : b.size;
          return (sizeA - sizeB) * direction;
        }
        case "modified": {
          const timeA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
          const timeB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
          return (timeA - timeB) * direction;
        }
        case "kind": {
          const kindA = a.type === "folder" ? "folder" : a.kind;
          const kindB = b.type === "folder" ? "folder" : b.kind;
          return kindA.localeCompare(kindB) * direction;
        }
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  })();

  const selected = entries.filter((entry) =>
    selection.includes(entryId(entry)),
  );

  function select(entry: ExplorerEntry, event: React.MouseEvent) {
    const id = entryId(entry);
    if (event.shiftKey && anchor) {
      const ids = entries.map(entryId);
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelection(ids.slice(start, end + 1));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelection((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
      setAnchor(id);
      return;
    }
    setSelection([id]);
    setAnchor(id);
  }

  function download(entry: ExplorerEntry) {
    if (entry.type === "folder") return;
    window.location.href = downloadHref(entry.key);
  }

  /** Double-click / Enter: folders open, previewable files preview, rest download. */
  function open(entry: ExplorerEntry) {
    if (entry.type === "folder") {
      navigate(entry.path);
      return;
    }
    if (previewKind(entry)) setPreview(entry);
    else download(entry);
  }

  /** Runs a mutation, then reloads — every one of them changes the store. */
  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      setSelection([]);
      await load();
    } catch (operationError) {
      toast.error(
        operationError instanceof Error
          ? operationError.message
          : "The operation failed.",
      );
    }
    setBusy(false);
  }

  async function upload(files: File[], target = path) {
    if (!files.length) return;

    // Batched to the route's per-request cap: it refuses a body larger than a
    // full batch of max-size files, so a bigger drop has to arrive as several
    // requests rather than one the server declines to buffer.
    setBusy(true);
    let uploaded = 0;
    try {
      for (const batch of batchedForUpload(files, MAX_UPLOADS_PER_REQUEST)) {
        const body = new FormData();
        for (const file of batch) body.append("file", file);
        body.set("path", target);

        const response = await fetch("/api/admin/storage", {
          method: "POST",
          body,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? "Upload failed.");
        }
        uploaded += batch.length;
      }
      toast.success(
        uploaded === 1
          ? `${files[0]?.name} uploaded.`
          : `${uploaded} files uploaded.`,
      );
      await load();
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Upload failed.";
      // A later batch failing leaves earlier ones written — say so rather than
      // let the listing disagree with the toast.
      toast.error(
        uploaded > 0
          ? `${message} ${uploaded} of ${files.length} uploaded.`
          : message,
      );
      if (uploaded > 0) await load();
    }
    setBusy(false);
  }

  function startDrag(entry: ExplorerEntry, event: React.DragEvent) {
    // Dragging an unselected item drags just that item, like Explorer.
    const ids = selection.includes(entryId(entry))
      ? selection
      : [entryId(entry)];
    if (!selection.includes(entryId(entry))) setSelection(ids);
    event.dataTransfer.setData(ENTRY_DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = "move";
  }

  function moveTo(target: string, ids: string[] = selection) {
    const folders = ids.filter((id) => id.endsWith("/"));
    const keys = ids.filter((id) => !id.endsWith("/"));
    if (!folders.length && !keys.length) return;
    if (target === path) return;
    run(
      () => moveEntries({ keys, folders, target }),
      `Moved to ${target || "the storage root"}.`,
    );
  }

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const segments = pathSegments(path);
  const treeTargets = flattenTree(tree);

  return (
    <PageContainer width="full">
      <PageHeader
        eyebrow="Platform admin"
        title="File storage"
        description="Browse the object store itself — every key, folder and orphan the backend holds."
      />

      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          upload(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="flex h-[calc(100svh-13rem)] min-h-[26rem] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {/* Address bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canGoBack}
              onClick={() => setHistoryIndex((current) => current - 1)}
            >
              <IconArrowLeft />
              <span className="sr-only">Back</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canGoForward}
              onClick={() => setHistoryIndex((current) => current + 1)}
            >
              <IconArrowRight />
              <span className="sr-only">Forward</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!path}
              onClick={() => navigate(parentPath(path))}
            >
              <IconArrowUp />
              <span className="sr-only">Up one level</span>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={load}>
              <IconRefresh />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>

          <nav
            aria-label="Address"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1"
          >
            <button
              type="button"
              onClick={() => navigate("")}
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-sm hover:bg-accent"
            >
              <IconServer className="size-4 text-primary" />
              Storage root
            </button>
            {segments.map((segment, index) => (
              <span key={segment.path} className="flex items-center">
                <IconChevronRight className="size-4 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => navigate(segment.path)}
                  aria-current={
                    index === segments.length - 1 ? "page" : undefined
                  }
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-sm hover:bg-accent",
                    index === segments.length - 1 && "font-semibold",
                  )}
                >
                  {segment.name}
                </button>
              </span>
            ))}
          </nav>

          <div className="relative w-full sm:w-56">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this folder"
              aria-label="Search this folder"
              className="h-8 pl-8"
            />
          </div>
        </div>

        {/* Command bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setTreeOpen(true)}
          >
            <IconList />
            Folders
          </Button>
          <Button size="sm" onClick={() => uploadRef.current?.click()}>
            <IconUpload />
            Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialog({ kind: "new-folder" })}
          >
            <IconFolderPlus />
            New folder
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            disabled={
              selected.length !== 1 ||
              selected[0]?.type !== "file" ||
              !previewKind(selected[0])
            }
            onClick={() => {
              const entry = selected[0];
              if (entry?.type === "file") setPreview(entry);
            }}
          >
            <IconEye />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={selected.length !== 1 || selected[0]?.type !== "file"}
            onClick={() => {
              const entry = selected[0];
              if (entry) download(entry);
            }}
          >
            <IconDownload />
            Download
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={selected.length !== 1}
            onClick={() => {
              const entry = selected[0];
              if (entry) setRenaming(entryId(entry));
            }}
          >
            <IconPencil />
            Rename
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={selected.length === 0}
            onClick={() => {
              setMoveTarget("");
              setDialog({ kind: "move", entries: selected });
            }}
          >
            <IconArrowRight />
            Move to
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={selected.length === 0}
            onClick={() => setDialog({ kind: "delete", entries: selected })}
          >
            <IconTrash className="text-destructive" />
            Delete
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="sm">
                    <IconLayoutGrid />
                    View
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setView("details")}>
                  <IconList />
                  Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView("tiles")}>
                  <IconLayoutList />
                  Tiles
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView("icons")}>
                  <IconLayoutGrid />
                  Large icons
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDetailsOpen((o) => !o)}>
                  <IconInfoCircle />
                  {detailsOpen ? "Hide" : "Show"} details pane
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm">
                    <IconDotsVertical />
                    <span className="sr-only">Sort</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {(
                  [
                    ["name", "Name"],
                    ["kind", "Kind"],
                    ["modified", "Date modified"],
                    ["size", "Size"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() =>
                      setSort((current) => ({
                        key,
                        direction:
                          current.key === key && current.direction === "asc"
                            ? "desc"
                            : "asc",
                      }))
                    }
                  >
                    Sort by {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Panes */}
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border lg:block">
            <ExplorerTree
              nodes={tree}
              path={path}
              onNavigate={navigate}
              onDropEntries={(target) => moveTo(target)}
            />
          </aside>

          <section
            aria-label="Folder contents"
            className="relative min-w-0 flex-1 overflow-auto"
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              dragDepth.current += 1;
              setDropping(true);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
            }}
            onDragLeave={() => {
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) setDropping(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              dragDepth.current = 0;
              setDropping(false);
              upload(Array.from(event.dataTransfer.files));
            }}
          >
            {loading ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 6 }, (_, index) => index).map((row) => (
                  <Skeleton key={row} className="h-10 rounded-md" />
                ))}
              </div>
            ) : error ? (
              <div className="p-10 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={load}
                >
                  Retry
                </Button>
              </div>
            ) : entries.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {query
                    ? "Nothing here matches that search."
                    : "This folder is empty."}
                </p>
                {!query ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => uploadRef.current?.click()}
                  >
                    <IconUpload />
                    Upload files
                  </Button>
                ) : null}
              </div>
            ) : (
              <ExplorerItems
                entries={entries}
                view={view}
                sort={sort}
                onSort={(key) =>
                  setSort((current) => ({
                    key,
                    direction:
                      current.key === key && current.direction === "asc"
                        ? "desc"
                        : "asc",
                  }))
                }
                selection={selection}
                onSelect={select}
                onSelectAll={() => setSelection(entries.map(entryId))}
                onClearSelection={() => setSelection([])}
                onOpen={open}
                renaming={renaming}
                onRename={(entry) => setRenaming(entryId(entry))}
                onRenameCancel={() => setRenaming(null)}
                onRenameSubmit={(entry, name) => {
                  setRenaming(null);
                  if (!name.trim() || name === entry.name) return;
                  run(
                    () =>
                      renameEntry({
                        key: entryId(entry),
                        name: name.trim(),
                        isFolder: entry.type === "folder",
                      }),
                    `Renamed to ${name.trim()}.`,
                  );
                }}
                onDownload={download}
                onCopyKey={async (entry) => {
                  try {
                    await navigator.clipboard.writeText(entryId(entry));
                    toast.success("Copied to the clipboard.");
                  } catch {
                    toast.error("Unable to copy.");
                  }
                }}
                onMove={(entry) => {
                  setSelection([entryId(entry)]);
                  setMoveTarget("");
                  setDialog({ kind: "move", entries: [entry] });
                }}
                onDelete={(entry) => {
                  const target = selection.includes(entryId(entry))
                    ? selected
                    : [entry];
                  setSelection(target.map(entryId));
                  setDialog({ kind: "delete", entries: target });
                }}
                onProperties={(entry) => {
                  setSelection([entryId(entry)]);
                  setDetailsOpen(true);
                }}
                onDragEntries={startDrag}
                onDropOnFolder={(target) => moveTo(target)}
              />
            )}

            {dropping ? (
              <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-primary border-dashed bg-secondary">
                <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <IconUpload className="size-4" />
                  Drop to upload into {path || "the storage root"}
                </span>
              </div>
            ) : null}

            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-card/60">
                <Spinner />
              </div>
            ) : null}
          </section>

          {detailsOpen ? (
            <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-border xl:block">
              <ExplorerDetails
                path={path}
                selection={selected}
                folderCount={listing?.folders.length ?? 0}
                fileCount={listing?.files.length ?? 0}
                totalSize={listing?.totalSize ?? 0}
              />
            </aside>
          ) : null}
        </div>

        {/* Status bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {entries.length} item{entries.length === 1 ? "" : "s"}
          </span>
          {selection.length ? (
            <span className="tabular-nums">{selection.length} selected</span>
          ) : null}
          <span className="tabular-nums">
            {formatBytes(listing?.totalSize ?? 0)} under this path
          </span>
          {listing?.truncated ? (
            <span className="text-warning">
              Scan capped at 5,000 keys — totals are a lower bound.
            </span>
          ) : null}
        </div>
      </div>

      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="px-4 pt-4">Folders</SheetTitle>
          <ExplorerTree
            nodes={tree}
            path={path}
            onNavigate={navigate}
            onDropEntries={(target) => moveTo(target)}
          />
        </SheetContent>
      </Sheet>

      <Dialog
        open={dialog?.kind === "new-folder"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
          setNewFolderName("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Created in {path || "the storage root"}. An object store has no
              real directories, so a zero-byte <code>.keep</code> marker holds
              the folder open until something lands in it.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="Folder name"
            aria-label="Folder name"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !newFolderName.trim()) return;
              setDialog(null);
              run(
                () => createFolder({ path, name: newFolderName.trim() }),
                `${newFolderName.trim()} created.`,
              );
              setNewFolderName("");
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!newFolderName.trim()}
              onClick={() => {
                const name = newFolderName.trim();
                setDialog(null);
                setNewFolderName("");
                run(() => createFolder({ path, name }), `${name} created.`);
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog?.kind === "move"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move {dialog?.kind === "move" ? dialog.entries.length : 0} item
              {dialog?.kind === "move" && dialog.entries.length === 1
                ? ""
                : "s"}
            </DialogTitle>
            <DialogDescription>
              Objects are copied to the new key and removed from the old one —
              the store has no rename. Registry rows follow their file.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <button
              type="button"
              onClick={() => setMoveTarget("")}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                moveTarget === "" && "bg-secondary font-semibold",
              )}
            >
              <IconServer className="size-4 text-primary" />
              Storage root
            </button>
            {treeTargets.map((target) => (
              <button
                key={target.path}
                type="button"
                onClick={() => setMoveTarget(target.path)}
                style={{ paddingLeft: `${12 + target.depth * 14}px` }}
                className={cn(
                  "flex w-full items-center gap-2 py-2 pr-3 text-left text-sm hover:bg-accent",
                  moveTarget === target.path && "bg-secondary font-semibold",
                )}
              >
                <IconFolderPlus className="size-4 text-primary" />
                {target.name}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const ids =
                  dialog?.kind === "move" ? dialog.entries.map(entryId) : [];
                setDialog(null);
                moveTo(moveTarget, ids);
              }}
            >
              Move here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={
          dialog?.kind === "delete" && dialog.entries.length === 1
            ? `Delete ${dialog.entries[0]?.name}?`
            : `Delete ${dialog?.kind === "delete" ? dialog.entries.length : 0} items?`
        }
        description="The bytes are removed from the store, folders with everything under them, and any registry row or profile picture that pointed at them is cleared. This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        variant="destructive"
        onConfirm={async () => {
          const targets = dialog?.kind === "delete" ? dialog.entries : [];
          setDialog(null);
          await run(
            () =>
              deleteEntries({
                keys: targets
                  .filter((entry) => entry.type === "file")
                  .map(entryId),
                folders: targets
                  .filter((entry) => entry.type === "folder")
                  .map(entryId),
              }),
            "Deleted.",
          );
        }}
      />
      <PreviewDialog
        file={preview}
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
      />
    </PageContainer>
  );
}
