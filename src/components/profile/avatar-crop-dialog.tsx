"use client";

import { useState } from "react";
import {
  ImageCrop,
  ImageCropApply,
  ImageCropContent,
  ImageCropReset,
} from "@/components/kibo-ui/image-crop";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Cap the cropped PNG well under the server's 5 MB limit — avatars render at
 * ~80px, so anything larger is wasted bytes. The cropper downscales until the
 * encoded blob fits.
 */
const MAX_CROPPED_BYTES = 1024 * 1024;

/**
 * Decode a base64 data URL by hand — `fetch(dataUrl)` is blocked by the app's
 * CSP (`connect-src` has no `data:` scheme).
 */
function dataUrlToFile(dataUrl: string, name: string): File {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, { type: "image/png" });
}

export function AvatarCropDialog({
  file,
  onCancel,
  onCropped,
}: {
  /** The picked source image, or `null` when the dialog is closed. */
  file: File | null;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const [applying, setApplying] = useState(false);

  function handleCrop(croppedDataUrl: string) {
    setApplying(true);
    try {
      onCropped(dataUrlToFile(croppedDataUrl, "avatar.png"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crop photo</DialogTitle>
          <DialogDescription>
            Drag the handles to choose what shows in your avatar.
          </DialogDescription>
        </DialogHeader>

        {file ? (
          <ImageCrop
            // Remount on a new pick so the crop box re-centers.
            key={`${file.name}-${file.size}-${file.lastModified}`}
            file={file}
            aspect={1}
            circularCrop
            keepSelection
            maxImageSize={MAX_CROPPED_BYTES}
            onCrop={handleCrop}
          >
            <div className="flex min-w-0 justify-center rounded-md bg-muted p-3">
              <ImageCropContent className="max-h-[320px]" />
            </div>

            <DialogFooter className="justify-between gap-2 sm:justify-between">
              <ImageCropReset asChild>
                <Button type="button" variant="ghost" disabled={applying}>
                  Reset
                </Button>
              </ImageCropReset>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={applying}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <ImageCropApply asChild>
                  <Button type="button" disabled={applying}>
                    {applying ? <Spinner /> : null}
                    Save photo
                  </Button>
                </ImageCropApply>
              </div>
            </DialogFooter>
          </ImageCrop>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
