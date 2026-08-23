"use client";

import {
  IconDownload,
  IconFile,
  IconFileText,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconFileZip,
  IconMusic,
  IconPaperclip,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  AttachmentDropzone,
  AttachmentUploadBar,
  useAttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import { Spinner } from "@/components/kibo-ui/spinner";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
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
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  deleteWorkItemAttachment,
  updateWorkItemAttachment,
} from "@/lib/actions/work-item-attachments";
import { formatBytes } from "@/lib/format-bytes";
import {
  canEditAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_DESCRIPTION,
  MAX_ATTACHMENT_FILE_NAME,
  type WorkItemAttachmentPayload,
  type WorkItemAttachmentRow,
} from "@/lib/work-item-attachments";

/**
 * The item's Attachments tab: every file on the item, wherever it was dropped.
 *
 * The per-field dropzones in the form are the fast path; this is the one that
 * has to be complete — it lists files dropped on any field, names which field
 * that was, and is the only surface with a real file input, so attaching is
 * possible from a keyboard and on touch where drag-and-drop does not exist.
 */
export function ItemAttachments({
  initial,
  onCountChange,
}: {
  initial: WorkItemAttachmentPayload;
  /** Keeps the tab's badge in step without a round trip. */
  onCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.attachments);
  const [editing, setEditing] = useState<WorkItemAttachmentRow | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // The page re-renders on revalidate, so the server list is the authority —
  // local state exists only so an upload or a delete shows immediately.
  useEffect(() => {
    setRows(initial.attachments);
  }, [initial.attachments]);

  useEffect(() => {
    onCountChange?.(rows.length);
  }, [rows.length, onCountChange]);

  const uploader = useAttachmentUploader({
    workItemId: initial.workItemId,
    canUpload: initial.canUpload,
    onUploaded: (created) => {
      setRows((current) => [...current, ...created]);
      router.refresh();
    },
  });

  function remove(row: WorkItemAttachmentRow) {
    startTransition(async () => {
      try {
        await deleteWorkItemAttachment({ attachmentId: row.id });
        setRows((current) => current.filter((item) => item.id !== row.id));
        toast.success(`${row.fileName} deleted.`);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't delete that file.",
        );
      }
    });
  }

  return (
    <AttachmentDropzone
      fieldKey={null}
      fieldLabel="this item"
      uploader={uploader}
      className="flex flex-col gap-4"
      // The bar goes under the button that started the upload, not at the
      // bottom of the file list where this zone ends.
      showProgress={false}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Drop files on any field to file them there, or add them here. Up to{" "}
          {formatBytes(MAX_ATTACHMENT_BYTES)} each.
        </p>
        {initial.canUpload ? (
          <>
            <Button
              onClick={() => inputRef.current?.click()}
              size="sm"
              variant="outline"
              disabled={uploader.isUploading(null)}
            >
              {uploader.isUploading(null) ? (
                <Spinner className="size-4" />
              ) : (
                <IconPlus className="size-4" />
              )}
              Add files
            </Button>
            {/* The keyboard/touch path. Hidden rather than absent: a drop
                target alone would make attaching mouse-only. */}
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void uploader.upload(files, null);
              }}
            />
          </>
        ) : null}
      </div>

      <AttachmentUploadBar fieldKey={null} uploader={uploader} />

      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyMedia variant="icon">
            <IconPaperclip />
          </EmptyMedia>
          <EmptyTitle>No files yet</EmptyTitle>
          <EmptyDescription>
            {initial.canUpload
              ? "Screenshots, logs, designs — drop them on the field they belong to, or use Add files."
              : "Nobody has attached anything to this item."}
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li className="min-w-0" key={row.id}>
              <AttachmentRow
                canEdit={canEditAttachment(row, initial)}
                onDelete={() => remove(row)}
                onEdit={() => setEditing(row)}
                pending={pending}
                row={row}
              />
            </li>
          ))}
        </ul>
      )}

      <EditAttachmentDialog
        key={editing?.id ?? "none"}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          setRows((current) =>
            current.map((item) => (item.id === next.id ? next : item)),
          );
          router.refresh();
        }}
        row={editing}
      />
    </AttachmentDropzone>
  );
}

function AttachmentRow({
  row,
  canEdit,
  pending,
  onEdit,
  onDelete,
}: {
  row: WorkItemAttachmentRow;
  canEdit: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const uploader = row.uploadedByName ?? row.uploadedByEmail ?? "Someone";
  const meta = [
    formatBytes(row.size),
    uploader,
    formatDistanceToNow(row.createdAt, { addSuffix: true }),
  ].join(" · ");

  return (
    <Attachment className="w-full">
      <AttachmentMedia variant={row.previewUrl ? "image" : "icon"}>
        {row.previewUrl ? (
          // biome-ignore lint/performance/noImgElement: next/image cannot proxy an authenticated storage route.
          <img alt="" src={row.previewUrl} />
        ) : (
          <FileGlyph contentType={row.contentType} />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{row.fileName}</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {meta}
        </AttachmentDescription>
        {row.description ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {row.description}
          </span>
        ) : null}
      </AttachmentContent>
      {row.fieldLabel ? (
        <Badge className="relative z-20 mr-1 shrink-0" variant="outline">
          {row.fieldLabel}
        </Badge>
      ) : null}
      <AttachmentActions className="pr-2">
        <AttachmentAction
          aria-label={`Download ${row.fileName}`}
          // A download is a link, not a button — so the primitive has to be told
          // it is rendering an anchor, or it warns about lost button semantics.
          nativeButton={false}
          render={<a download={row.fileName} href={row.url} />}
        >
          <IconDownload />
        </AttachmentAction>
        {canEdit ? (
          <>
            <AttachmentAction
              aria-label={`Rename ${row.fileName}`}
              disabled={pending}
              onClick={onEdit}
            >
              <IconPencil />
            </AttachmentAction>
            <ConfirmDialog
              confirmLabel="Delete"
              description="The file is removed from storage as well — this can't be undone."
              onConfirm={onDelete}
              title={`Delete ${row.fileName}?`}
              trigger={
                <AttachmentAction
                  aria-label={`Delete ${row.fileName}`}
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                >
                  <IconTrash />
                </AttachmentAction>
              }
              variant="destructive"
            />
          </>
        ) : null}
      </AttachmentActions>
      {/* Covers the row: previews what can be previewed, downloads the rest. */}
      <AttachmentTrigger
        aria-label={`Open ${row.fileName}`}
        render={
          <a
            href={row.previewUrl ?? row.url}
            rel="noopener noreferrer"
            target="_blank"
          />
        }
      />
    </Attachment>
  );
}

/** Rename, and caption. Both are this row's own text, so they save together. */
function EditAttachmentDialog({
  row,
  onClose,
  onSaved,
}: {
  row: WorkItemAttachmentRow | null;
  onClose: () => void;
  onSaved: (next: WorkItemAttachmentRow) => void;
}) {
  const [fileName, setFileName] = useState(row?.fileName ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!row) return;
    const trimmed = fileName.trim();
    if (!trimmed) {
      toast.error("A file needs a name.");
      return;
    }
    startTransition(async () => {
      try {
        await updateWorkItemAttachment({
          attachmentId: row.id,
          description: description.trim() || null,
          fileName: trimmed,
        });
        onSaved({
          ...row,
          description: description.trim() || null,
          fileName: trimmed,
        });
        toast.success("Attachment updated.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't save that change.",
        );
      }
    });
  }

  return (
    <Dialog
      onOpenChange={(open) => (open ? null : onClose())}
      open={row !== null}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit attachment</DialogTitle>
          <DialogDescription>
            The name is what this downloads as. The note explains why the file
            is here.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="attachment-name">File name</FieldLabel>
          <Input
            id="attachment-name"
            maxLength={MAX_ATTACHMENT_FILE_NAME}
            onChange={(event) => setFileName(event.target.value)}
            value={fileName}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="attachment-note">Note</FieldLabel>
          <Textarea
            id="attachment-note"
            maxLength={MAX_ATTACHMENT_DESCRIPTION}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this shows, or where it came from."
            value={description}
          />
        </Field>
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? <Spinner className="size-4" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A glyph for what the file IS. Colour stays on the mark and never fills the
 * tile — the tile is the neutral `--muted` square AttachmentMedia already
 * draws.
 */
function FileGlyph({ contentType }: { contentType: string }) {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) {
    return <IconPhoto className="text-chart-1" />;
  }
  if (type.startsWith("video/")) return <IconVideo className="text-chart-2" />;
  if (type.startsWith("audio/")) return <IconMusic className="text-chart-3" />;
  if (type === "application/pdf") {
    return <IconFileTypePdf className="text-destructive" />;
  }
  if (type === "text/csv" || type.includes("spreadsheet")) {
    return <IconFileTypeCsv className="text-success" />;
  }
  if (type.includes("zip") || type.includes("compressed")) {
    return <IconFileZip className="text-warning" />;
  }
  if (type.startsWith("text/") || type === "application/json") {
    return <IconFileText className="text-muted-foreground" />;
  }
  return <IconFile className="text-muted-foreground" />;
}
