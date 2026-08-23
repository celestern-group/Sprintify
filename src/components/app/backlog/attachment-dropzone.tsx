"use client";

import { IconCheck, IconPaperclip } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import {
  batchedForUpload,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REQUEST,
  type WorkItemAttachmentRow,
} from "@/lib/work-item-attachments";

/**
 * Drag-and-drop attaching, per field.
 *
 * Two halves: a hook that owns the upload (so the Attachments tab's "Add files"
 * button and a drop on Steps to reproduce go through exactly one code path), and
 * a wrapper that turns any field into a drop target. The wrapper records WHICH
 * field took the drop — that is the whole point of dropping on a field rather
 * than on the item.
 *
 * Drag-and-drop is never the only way in: it can't be operated from a keyboard
 * and doesn't exist on touch. Every drop target here is paired with a real file
 * input in the Attachments tab, which is what keyboard and mobile users use.
 */

export type AttachmentUploader = {
  /**
   * Uploads now (saved item) or stages for after create. Never throws, and
   * resolves to the rows the server created — a prose field needs their URLs to
   * write links, and staging resolves to an empty list.
   */
  upload: (
    files: File[],
    fieldKey: string | null,
  ) => Promise<WorkItemAttachmentRow[]>;
  /** True while ANY upload is in flight — rarely what a field wants. */
  uploading: boolean;
  /**
   * True only while THIS field's upload is in flight. One uploader is shared by
   * every field on the item, so a single boolean would spin the paperclip on all
   * of them at once; the busy state belongs to the field that took the drop.
   */
  isUploading: (fieldKey: string | null) => boolean;
  /**
   * Everything in flight for one field, collapsed into a single bar, or null
   * when that field is idle. Several drops on the same field read as one
   * transfer — a stack of bars would say nothing extra.
   */
  progressFor: (fieldKey: string | null) => AttachmentUploadProgress | null;
  /** False when the caller may not attach, or the surface is read-only. */
  enabled: boolean;
  /** True before the item exists — drops are held, not sent. */
  staging: boolean;
};

export type AttachmentUploadProgress = {
  /** How many files this bar covers — the label says so past one. */
  fileCount: number;
  /** The first file's name; what a single-file transfer is called. */
  fileName: string;
  loadedBytes: number;
  totalBytes: number;
  /** 0–100, floored so it never reads 100 while bytes are still moving. */
  percent: number;
  /**
   * The bytes are sent and the server is still writing them to the store. The
   * bar can't measure that half, so it says what it's doing instead of sitting
   * at 100% looking stuck.
   */
  finishing: boolean;
  /** Landed. Held on screen briefly so a fast upload still says something. */
  done: boolean;
};

/**
 * How long a bar stays on screen at minimum. Long enough to register as an
 * event, short enough that it isn't in the way of the next edit.
 */
const MIN_PROGRESS_VISIBLE_MS = 900;

type ActiveUpload = AttachmentUploadProgress & {
  id: number;
  fieldKey: string | null;
};

type UploadResponse = {
  ok: boolean;
  payload: { attachments?: WorkItemAttachmentRow[]; error?: string } | null;
};

/**
 * XHR rather than `fetch`, for exactly one reason: `fetch` cannot report how
 * much of a REQUEST body has gone out (its streaming upload half isn't
 * available here), and a 25 MB file on a hotel connection needs a number, not a
 * spinner. Everything else about the call is the same POST.
 */
function postAttachments(
  url: string,
  body: FormData,
  onProgress: (loaded: number, total: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.upload.addEventListener("progress", (event) => {
      // Non-computable happens when the browser can't size the body; leave the
      // last known numbers alone rather than resetting the bar to zero.
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    request.addEventListener("load", () => {
      let payload: UploadResponse["payload"] = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }
      resolve({ ok: request.status >= 200 && request.status < 300, payload });
    });
    request.addEventListener("error", () => reject(new Error("network")));
    request.addEventListener("abort", () => reject(new Error("aborted")));
    request.send(body);
  });
}

export function useAttachmentUploader(input: {
  /** Null in create mode: there is nothing to attach TO yet. */
  workItemId: string | null;
  canUpload: boolean;
  /** Saved-item path: the rows the server created, already shaped. */
  onUploaded?: (rows: WorkItemAttachmentRow[], fieldKey: string | null) => void;
  /** Create-mode path: hold the files until the item has an id. */
  onStage?: (files: File[], fieldKey: string | null) => void;
}): AttachmentUploader {
  // Every transfer in flight, one entry per call — a list rather than a map
  // keyed by field, so two drops on the same field are both counted and the
  // second finishing doesn't clear the first's bar.
  const [uploads, setUploads] = useState<ActiveUpload[]>([]);
  const nextId = useRef(0);
  const retireTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Read through refs so a drop handler captured in a memoised child still
  // calls the current callbacks.
  const callbacks = useRef(input);
  callbacks.current = input;

  useEffect(() => {
    const timers = retireTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /**
   * Clears a finished transfer, but never before the bar has been on screen
   * long enough to be seen.
   *
   * A small file on a fast connection is done in under a frame: state goes on
   * and straight back off, React coalesces the two, and nothing ever paints —
   * which reads as "the upload showed no indication at all". So a short upload
   * is held at 100% for the rest of the window instead, and it doubles as the
   * confirmation that it landed.
   */
  const retire = useCallback(
    (id: number, startedAt: number, succeeded: boolean) => {
      const drop = () => setUploads((list) => list.filter((e) => e.id !== id));
      const remaining =
        MIN_PROGRESS_VISIBLE_MS - (performance.now() - startedAt);

      // A failure has its own toast; holding a bar open to say "Attached" about
      // a file that wasn't would be worse than showing nothing.
      if (remaining <= 0 || !succeeded) {
        drop();
        return;
      }

      setUploads((list) =>
        list.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                loadedBytes: entry.totalBytes,
                percent: 100,
                finishing: false,
                done: true,
              }
            : entry,
        ),
      );
      const timer = setTimeout(() => {
        retireTimers.current.delete(timer);
        drop();
      }, remaining);
      retireTimers.current.add(timer);
    },
    [],
  );

  const upload = useCallback(
    async (files: File[], fieldKey: string | null) => {
      const current = callbacks.current;
      if (!current.canUpload || files.length === 0) return [];

      const tooBig = files.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
      if (tooBig.length > 0) {
        toast.error(
          `${tooBig.map((file) => file.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit.`,
        );
        return [];
      }
      const empty = files.filter((file) => file.size === 0);
      if (empty.length > 0) {
        toast.error(
          `${empty.map((file) => file.name).join(", ")} ${empty.length === 1 ? "is" : "are"} empty.`,
        );
        return [];
      }

      // No item yet — hold the files in the form and let Create send them.
      if (!current.workItemId) {
        current.onStage?.(files, fieldKey);
        return [];
      }

      // One request per MAX_ATTACHMENTS_PER_REQUEST files. The per-item cap is
      // five times the per-request one, so a drop the item has room for is
      // routinely more than a request may carry — sending it whole is a 413 for
      // files that were perfectly acceptable.
      const batches = batchedForUpload(files, MAX_ATTACHMENTS_PER_REQUEST);
      // Every bar is registered before the first byte moves: `progressFor`
      // collapses a field's entries into one, so the total reads as the whole
      // drop from the start rather than growing a batch at a time.
      const pending = batches.map((batch) => ({
        id: nextId.current++,
        batch,
      }));
      setUploads((current_) => [
        ...current_,
        ...pending.map(({ id, batch }) => ({
          id,
          fieldKey,
          fileCount: batch.length,
          fileName: batch[0]?.name ?? "File",
          loadedBytes: 0,
          // Seeded from the file sizes so the bar has a scale before the first
          // progress event; the browser's own total replaces it once it arrives
          // (it includes the multipart envelope, so it is a little larger).
          totalBytes: batch.reduce((sum, file) => sum + file.size, 0),
          percent: 0,
          finishing: false,
          done: false,
        })),
      ]);

      const uploaded: WorkItemAttachmentRow[] = [];
      let failure: string | null = null;

      for (const [index, { id, batch }] of pending.entries()) {
        // A batch that failed on the per-item cap or a lost item means every
        // batch behind it fails the same way — stop rather than spend the
        // bytes and stack up identical toasts.
        if (failure) {
          retire(id, performance.now(), false);
          continue;
        }

        const startedAt = performance.now();
        let succeeded = false;
        try {
          const body = new FormData();
          for (const file of batch) body.append("file", file);
          if (fieldKey) body.append("fieldKey", fieldKey);

          const response = await postAttachments(
            `/api/work-items/${current.workItemId}/attachments`,
            body,
            (loaded, total) => {
              setUploads((list) =>
                list.map((entry) =>
                  entry.id === id
                    ? {
                        ...entry,
                        loadedBytes: loaded,
                        totalBytes: total,
                        // Floored: 99.6% is not 100%, and a bar that reads 100 while
                        // bytes are still moving is the thing people complain about.
                        percent:
                          total > 0
                            ? Math.floor((loaded / total) * 100)
                            : entry.percent,
                        finishing: loaded >= total,
                      }
                    : entry,
                ),
              );
            },
          );
          const payload = response.payload;

          if (!response.ok) {
            failure = payload?.error ?? "Couldn't attach that file.";
            continue;
          }
          succeeded = true;

          uploaded.push(
            ...(payload?.attachments ?? []).map((row) => ({
              ...row,
              // JSON has no Date; the list sorts and formats on this.
              createdAt: new Date(row.createdAt),
            })),
          );
        } catch {
          failure =
            index === 0
              ? "Couldn't reach the server — the upload didn't happen."
              : "Couldn't reach the server — some files weren't attached.";
        } finally {
          retire(id, startedAt, succeeded);
        }
      }

      // Whatever landed is real and the list has to show it, even when a later
      // batch failed.
      if (uploaded.length > 0) current.onUploaded?.(uploaded, fieldKey);

      if (failure) {
        toast.error(
          uploaded.length === 0
            ? failure
            : `${failure} ${uploaded.length} of ${files.length} files attached.`,
        );
      } else {
        toast.success(
          uploaded.length === 1
            ? `${uploaded[0]?.fileName ?? "File"} attached.`
            : `${uploaded.length} files attached.`,
        );
      }
      return uploaded;
    },
    [retire],
  );

  // `done` entries are still in the list — they are the bar's hold-open window,
  // not work in flight. The paperclip stops spinning and the button re-enables
  // the moment the bytes have landed.
  const isUploading = useCallback(
    (fieldKey: string | null) =>
      uploads.some((entry) => entry.fieldKey === fieldKey && !entry.done),
    [uploads],
  );

  const progressFor = useCallback(
    (fieldKey: string | null): AttachmentUploadProgress | null => {
      const mine = uploads.filter((entry) => entry.fieldKey === fieldKey);
      if (mine.length === 0) return null;

      const loadedBytes = mine.reduce((sum, e) => sum + e.loadedBytes, 0);
      const totalBytes = mine.reduce((sum, e) => sum + e.totalBytes, 0);
      return {
        fileCount: mine.reduce((sum, e) => sum + e.fileCount, 0),
        fileName: mine[0]?.fileName ?? "File",
        loadedBytes,
        totalBytes,
        percent:
          totalBytes > 0 ? Math.floor((loadedBytes / totalBytes) * 100) : 0,
        // Only once EVERY transfer on this field has its bytes out — one still
        // sending means the bar is still measuring something real.
        finishing: mine.every((e) => e.finishing),
        done: mine.every((e) => e.done),
      };
    },
    [uploads],
  );

  return {
    upload,
    uploading: uploads.some((entry) => !entry.done),
    isUploading,
    progressFor,
    enabled: input.canUpload,
    staging: input.workItemId === null,
  };
}

/**
 * The live bar for one field's upload — nothing when that field is idle.
 *
 * It measures the REQUEST, which is the only half the browser can see: once the
 * bytes are out, the server is still writing them to the object store, so the
 * bar says "Finishing" rather than sitting at 100% looking hung. Percentage and
 * bytes both, because 45% of an unknown size tells you nothing about how long
 * is left.
 */
export function AttachmentUploadBar({
  uploader,
  fieldKey,
  className,
}: {
  uploader: AttachmentUploader;
  fieldKey: string | null;
  className?: string;
}) {
  const progress = uploader.progressFor(fieldKey);
  if (!progress) return null;

  const what =
    progress.fileCount === 1
      ? progress.fileName
      : `${progress.fileCount} files`;
  const label = progress.done
    ? `Attached ${what}`
    : progress.finishing
      ? `Finishing ${what}`
      : `Uploading ${what}`;

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-slot="attachment-upload"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {progress.done ? (
          <IconCheck aria-hidden className="size-3.5 shrink-0 text-success" />
        ) : (
          <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {/* The live region is the LABEL alone: it changes twice (started,
            finishing), so a screen reader hears the state. The counter beside it
            changes on every packet and is hidden — announcing 4% 7% 9% is how a
            progress bar becomes unusable with a reader on. */}
        <span aria-live="polite" className="min-w-0 truncate font-medium">
          {label}
        </span>
        <span
          aria-hidden
          className="ml-auto shrink-0 text-muted-foreground tabular-nums"
        >
          {progress.finishing || progress.done
            ? formatBytes(progress.totalBytes)
            : `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)} · ${progress.percent}%`}
        </span>
      </div>
      <Progress
        aria-label={label}
        // The track is the system's 12px pill by default — too loud for a
        // status line that sits under a form control.
        className={cn(
          "w-full gap-0 **:data-[slot=progress-track]:h-1.5",
          progress.done && "**:data-[slot=progress-indicator]:bg-success",
        )}
        value={progress.percent}
      />
    </div>
  );
}

/**
 * Wraps a field so a file dropped anywhere on it attaches to the item and is
 * tagged with that field.
 *
 * `onDropCapture` rather than `onDrop`: a prose field's editor registers its own
 * DOM drop handler, and only stopping the event on the way DOWN keeps a dropped
 * PDF from being pasted in as text. The counter is what makes dragging over a
 * child element not flicker the highlight off.
 */
export function AttachmentDropzone({
  fieldKey,
  fieldLabel,
  uploader,
  disabled,
  className,
  children,
  onUploaded,
  showProgress = true,
}: {
  /** Null = the item itself (the Attachments tab), not one of its fields. */
  fieldKey: string | null;
  fieldLabel: string;
  uploader: AttachmentUploader;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  /**
   * False when the caller places `AttachmentUploadBar` itself. A zone that wraps
   * a whole panel (the Attachments tab) wants the bar up by its button, not
   * under the file list — everything else wants it under the control it belongs
   * to, which is what the default does.
   */
  showProgress?: boolean;
  /**
   * What THIS target does with the rows it just created, on top of whatever the
   * uploader does globally — a prose field writes a link into the document.
   */
  onUploaded?: (rows: WorkItemAttachmentRow[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const active = uploader.enabled && !disabled;

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target is not a control; the keyboard path is the file input in the Attachments tab.
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!active || !hasFiles(event)) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!active || !hasFiles(event)) return;
        // Without this the browser navigates to the file instead of dropping.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!active || !hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDropCapture={(event) => {
        if (!active || !hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setDragging(false);
        void uploader
          .upload(Array.from(event.dataTransfer.files), fieldKey)
          .then((rows) => {
            if (rows.length > 0) onUploaded?.(rows);
          });
      }}
    >
      {children}
      {/* In the flow, not floating over the control: a bar pinned to the bottom
          edge covers the last line of a short input, and this one is worth
          reading. */}
      {showProgress ? (
        <AttachmentUploadBar
          className="mt-2"
          fieldKey={fieldKey}
          uploader={uploader}
        />
      ) : null}
      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[11px] border-2 border-primary border-dashed bg-secondary/85"
        >
          <span className="flex items-center gap-2 text-secondary-foreground text-sm font-semibold">
            <IconPaperclip className="size-4" />
            {uploader.staging
              ? `Hold for ${fieldLabel}`
              : `Attach to ${fieldLabel}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
