"use client";

import type { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { EditorProps } from "@tiptap/pm/view";
import type { AttachmentUploader } from "@/components/app/backlog/attachment-dropzone";
import { imageFilesFrom, isAttachmentImageSrc } from "@/lib/attachment-images";
import { cn } from "@/lib/utils";
import type { WorkItemAttachmentRow } from "@/lib/work-item-attachments";

// What a prose editor does with a picture: paste one, and it uploads as a real
// attachment and renders inline; everything else that isn't a picture stays a
// link at the caret.
//
// Shared by RichTextField and CommentEditor rather than written twice, because
// the two halves that have to agree — which `src` values render, and how a
// clipboard image becomes an attachment row — are the same on both surfaces and
// the sanitizer that reads the result is a single one (src/lib/markdown.ts).

/**
 * The inline-image node.
 *
 * `parseHTML` is narrowed to our own attachment previews, and that narrowing is
 * the point: an image copied out of a web page arrives as `<img src="https://…">`,
 * which the server-side sanitizer discards on render. Accepting it in the editor
 * would show the author a picture that vanishes the moment they save — so it is
 * refused at the same boundary instead. Returning `false` from `getAttrs` makes
 * ProseMirror decline the match entirely rather than create a broken node.
 *
 * `allowBase64: false` for the same reason: a `data:` URI is not something the
 * markdown pipeline will ever hand back.
 */
/**
 * What an image picker offers — the types the attachment route will actually
 * serve back inline (`INLINE_IMAGE` in src/lib/storage/inline-types.ts).
 *
 * Not `image/*`: that lets someone pick an SVG, which uploads perfectly well
 * and then renders as a download link, because a script-bearing image is never
 * served inline. A picker that offers a file the surface can't show is a picker
 * that lies. It narrows the dialog only — the route re-checks everything, and a
 * person can always switch the picker back to "all files".
 */
export const INLINE_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon";

export const attachmentImageExtension = Image.extend({
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) =>
          element instanceof HTMLElement &&
          isAttachmentImageSrc(element.getAttribute("src") ?? undefined)
            ? null
            : false,
      },
    ];
  },
}).configure({ inline: false, allowBase64: false });

/**
 * How an inline image is sized, wherever prose renders — the editor, and the
 * server-rendered comment body.
 *
 * A phone screenshot is ~1200×2600: at its natural size it is taller than the
 * viewport and pushes everything below it off the page. Capping the HEIGHT
 * rather than only the width is what keeps a portrait screenshot to a thumbnail
 * you can scan past; `w-auto` keeps it from stretching once the height binds,
 * and `max-w-full` keeps a wide screenshot inside the column on a 375px screen.
 */
export const IMAGE_PROSE_CLASS = cn(
  "[&_img]:my-2 [&_img]:h-auto [&_img]:max-h-80 [&_img]:w-auto [&_img]:max-w-full",
  "[&_img]:rounded-[8px] [&_img]:border [&_img]:border-border [&_img]:object-contain",
);

/**
 * A filename and a URL are handed to the editor as HTML (that is how a link
 * mark is created in one call), so both are escaped first. The URL is one we
 * built and the name is sanitized server-side, but "the input was already
 * clean" is not a property this function can check — and a file called
 * `a"><b.txt` would otherwise break out of the attribute.
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

/**
 * Writes uploaded attachments into the document at the caret: images as
 * pictures, everything else as a link.
 *
 * An image goes in as an `<img>` pointing at the preview URL — the same URL the
 * sanitizer's allow-list is written around, so what the author sees while typing
 * is what every reader gets back. A PDF or a log has no inline form the pipeline
 * can render, so it stays a link, which is what this did for every file before
 * pictures were inlined.
 *
 * The alt text is the file name: it is the only description anyone has supplied
 * at paste time, and it beats an empty alt for a reader who can't see the shot.
 */
export function insertAttachmentContent(
  editor: Editor | null,
  rows: WorkItemAttachmentRow[],
): void {
  if (!editor || rows.length === 0) return;

  const html = rows
    .map((row) =>
      row.isImage && row.previewUrl
        ? `<img src="${escapeHtmlAttribute(row.previewUrl)}" alt="${escapeHtmlAttribute(row.fileName)}">`
        : `<a href="${escapeHtmlAttribute(row.url)}">${escapeHtmlText(row.fileName)}</a>`,
    )
    .join(" ");

  // Through the editor, not through `value`: the document is uncontrolled, so
  // state alone would leave what is on screen unchanged. onUpdate fires from
  // this, which is what carries the new markdown back up.
  editor.chain().focus().insertContent(`${html} `).run();
}

/**
 * A `handlePaste` that turns clipboard images into attachments.
 *
 * Only images are intercepted. A pasted PDF or spreadsheet is left to the
 * browser (which pastes nothing useful) rather than silently uploaded: dropping
 * a file on the field is the deliberate gesture for that, and it is the one that
 * says which field it landed on. Pasting a screenshot, by contrast, has no other
 * meaning — there is nothing else the clipboard could have wanted.
 *
 * Returns `true` only when it took the paste, so text, HTML and markdown all
 * still paste exactly as before.
 */
export function createImagePasteHandler(attach: {
  fieldKey: string | null;
  uploader: AttachmentUploader;
  editorRef: { current: Editor | null };
}): NonNullable<EditorProps["handlePaste"]> {
  return (_view, event) => {
    if (!attach.uploader.enabled) return false;
    const files = imageFilesFrom(event.clipboardData);
    if (files.length === 0) return false;

    event.preventDefault();
    void attach.uploader
      .upload(files, attach.fieldKey)
      // Staging (create mode) resolves to no rows: there is no item to hang the
      // bytes on yet, so the uploader holds them and the form's own notice says
      // they land on create. Nothing to insert until they have URLs.
      .then((rows) => insertAttachmentContent(attach.editorRef.current, rows));
    return true;
  };
}
