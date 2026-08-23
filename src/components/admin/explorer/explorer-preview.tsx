"use client";

import { IconDownload, IconEyeOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import {
  downloadHref,
  type ExplorerFile,
  previewHref,
  previewKind,
} from "./explorer-utils";

/** Text previews are a peek, not a viewer — stop well short of a huge object. */
const MAX_TEXT_BYTES = 200_000;

function TextPreview({
  file,
  className,
}: {
  file: ExplorerFile;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);

    fetch(previewHref(file.key))
      .then(async (response) => {
        if (!response.ok) throw new Error("This object cannot be previewed.");
        return response.text();
      })
      .then((body) => {
        if (!cancelled) setText(body.slice(0, MAX_TEXT_BYTES));
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to read this object.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file.key]);

  if (error) return <PreviewMessage file={file} message={error} />;
  if (text === null) {
    return (
      <div className="flex items-center justify-center p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <pre
      className={cn(
        "overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap",
        className,
      )}
    >
      {text}
      {file.size > MAX_TEXT_BYTES ? "\n\n… truncated." : ""}
    </pre>
  );
}

function PreviewMessage({
  file,
  message,
}: {
  file: ExplorerFile;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <IconEyeOff className="size-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <a href={downloadHref(file.key)} download>
            <IconDownload />
            Download
          </a>
        }
      />
    </div>
  );
}

/**
 * Renders one object's contents. Everything here is served by the storage route
 * under `sandbox` + `nosniff` and only for a whitelist of non-executable types,
 * so an uploaded file can never run in the app's origin — PDFs additionally sit
 * in a sandboxed iframe.
 */
export function PreviewSurface({
  file,
  size,
}: {
  file: ExplorerFile;
  size: "pane" | "dialog";
}) {
  const kind = previewKind(file);
  const dialog = size === "dialog";

  if (!kind) {
    return (
      <PreviewMessage
        file={file}
        message="No preview for this type — download it to inspect the bytes."
      />
    );
  }

  if (kind === "image") {
    return (
      // Raw bytes from the object store, not an optimizable app asset.
      // biome-ignore lint/performance/noImgElement: next/image cannot proxy an authenticated storage route.
      <img
        src={previewHref(file.key)}
        alt={file.ownerLabel ?? file.name}
        className={cn(
          "mx-auto rounded-md bg-muted object-contain",
          dialog ? "max-h-[70svh] w-auto max-w-full" : "max-h-40 w-full",
        )}
      />
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        title={`Preview of ${file.name}`}
        src={previewHref(file.key)}
        sandbox=""
        className={cn(
          "w-full rounded-md border border-border bg-muted",
          dialog ? "h-[70svh]" : "h-40",
        )}
      />
    );
  }

  if (kind === "audio") {
    return (
      <audio controls className="w-full" src={previewHref(file.key)}>
        <track kind="captions" />
      </audio>
    );
  }

  if (kind === "video") {
    return (
      <video
        controls
        className={cn("w-full rounded-md bg-black", dialog && "max-h-[70svh]")}
        src={previewHref(file.key)}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <TextPreview
      file={file}
      className={dialog ? "max-h-[70svh]" : "max-h-40"}
    />
  );
}

/** Full-size preview, opened by double-clicking a previewable file. */
export function PreviewDialog({
  file,
  open,
  onOpenChange,
}: {
  file: ExplorerFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {file?.ownerLabel ?? file?.name ?? "Preview"}
          </DialogTitle>
          <DialogDescription className="min-w-0 truncate font-mono text-xs">
            {file ? `${file.key} · ${formatBytes(file.size)}` : null}
          </DialogDescription>
        </DialogHeader>
        {file ? <PreviewSurface file={file} size="dialog" /> : null}
        {file ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a href={downloadHref(file.key)} download>
                  <IconDownload />
                  Download
                </a>
              }
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
