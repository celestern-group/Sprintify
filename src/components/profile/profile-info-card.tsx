"use client";

import { CameraIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { AvatarCropDialog } from "@/components/profile/avatar-crop-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

// Keep in sync with the server route (src/lib/storage/avatar.ts).
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ProfileInfoCard({
  initialName,
  initialImage,
}: {
  initialName: string;
  initialImage: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [image, setImage] = useState(initialImage);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Picked source image awaiting a crop; `null` while the dialog is closed.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // 0-100 while an upload is in flight, `null` otherwise.
  const [progress, setProgress] = useState<number | null>(null);

  const nameDirty = name !== initialName;
  const busy = uploading || removing;

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingName(true);
    const { error } = await authClient.updateUser({ name });
    setSavingName(false);

    if (error) {
      toast.error(error.message ?? "Unable to update profile.");
      return;
    }

    toast.success("Profile updated.");
    router.refresh();
  }

  /** Validate a picked image, then hand it to the cropper. */
  function pickFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Unsupported image type (use JPEG, PNG, WebP, or GIF).");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Image is too large (max 5 MB).");
      return;
    }

    setPendingFile(file);
  }

  /**
   * XHR rather than `fetch` — only XHR reports upload progress, and the panel
   * shows a determinate bar while the bytes are in flight.
   */
  function uploadFile(file: File) {
    setUploading(true);
    setProgress(0);

    const body = new FormData();
    body.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/profile/avatar");
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    // `loadend` covers success, HTTP error and network failure alike.
    request.addEventListener("loadend", () => {
      setUploading(false);
      setProgress(null);

      const payload = request.response as {
        image?: string;
        error?: string;
      } | null;

      if (request.status < 200 || request.status > 299 || !payload?.image) {
        toast.error(payload?.error ?? "Unable to upload avatar.");
        return;
      }

      setImage(payload.image);
      toast.success("Avatar updated.");
      router.refresh();
    });

    request.send(body);
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file later.
    event.target.value = "";
    if (file) pickFile(file);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  async function removeAvatar() {
    setRemoving(true);
    const response = await fetch("/api/profile/avatar", { method: "DELETE" });
    setRemoving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      toast.error(data?.error ?? "Unable to remove avatar.");
      return;
    }

    setImage("");
    toast.success("Avatar removed.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your name and avatar as shown across Sprintify.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        {/* Identity block — the whole panel is the drop target, not just the
            avatar, so a dropped file doesn't have to hit an 80px circle. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is
            pointer-only by nature; the avatar button and Change button are the
            keyboard-operable equivalents. */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-dragging={dragging || undefined}
          className="flex flex-col gap-3 rounded-md border border-border bg-muted/60 p-4 transition-colors data-dragging:border-primary data-dragging:bg-secondary"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={onFileSelected}
          />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={busy}
              aria-label={image ? "Change avatar" : "Upload avatar"}
              onClick={() => fileInputRef.current?.click()}
              className="group/upload relative shrink-0 cursor-pointer self-start rounded-full outline-none ring-offset-2 ring-offset-muted transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default sm:self-auto"
            >
              <Avatar className="size-16">
                <AvatarImage src={image || undefined} alt="" />
                <AvatarFallback className="bg-secondary font-heading text-xl font-semibold text-secondary-foreground">
                  {initialsOf(name) || "?"}
                </AvatarFallback>
              </Avatar>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-foreground/55 text-background opacity-0 transition-opacity group-hover/upload:opacity-100 group-focus-visible/upload:opacity-100 group-disabled/upload:opacity-0"
              >
                {uploading ? <Spinner /> : <CameraIcon className="size-5" />}
              </span>
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-semibold">Profile photo</p>
              <p className="text-xs text-muted-foreground">
                {dragging
                  ? "Drop to upload"
                  : "JPEG, PNG, WebP or GIF · up to 5 MB · cropped to a square"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Spinner /> : null}
                {image ? "Change" : "Upload"}
              </Button>
              {image ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={removeAvatar}
                >
                  {removing ? <Spinner /> : null}
                  Remove
                </Button>
              ) : null}
            </div>
          </div>

          {progress === null ? null : (
            <div className="flex items-center gap-3">
              <Progress
                value={progress}
                aria-label="Upload progress"
                className="flex-1 gap-0 **:data-[slot=progress-track]:h-1.5"
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {progress}%
              </span>
            </div>
          )}
        </div>

        <div className="my-5 h-px bg-border" />

        <form id="profile-info-form" onSubmit={saveName} noValidate>
          <Field className="gap-2">
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input
              id="profile-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="sm:max-w-sm"
            />
            <FieldDescription>
              Shown to teammates across your organizations.
            </FieldDescription>
          </Field>
        </form>
      </CardContent>

      <CardFooter className="justify-end border-t [.border-t]:pt-6">
        <Button
          type="submit"
          form="profile-info-form"
          disabled={savingName || !nameDirty}
        >
          {savingName ? <Spinner /> : null}
          Save changes
        </Button>
      </CardFooter>

      <AvatarCropDialog
        file={pendingFile}
        onCancel={() => setPendingFile(null)}
        onCropped={(cropped) => {
          setPendingFile(null);
          uploadFile(cropped);
        }}
      />
    </Card>
  );
}
