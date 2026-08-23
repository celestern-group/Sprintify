/**
 * What may be handed to a browser to RENDER rather than download.
 *
 * Shared by the platform storage browser and the work-item attachment route,
 * because "is this safe to render in our own origin" must have exactly one
 * answer: anything script-bearing (`image/svg+xml`, `text/html`, XML, JS)
 * executes as us, so it stays a download no matter what the store recorded, and
 * text is transcoded to `text/plain` so a mislabelled document can't become
 * markup. Callers still send `sandbox` + `nosniff` with the bytes.
 *
 * Client-safe: plain data and string work, no storage or db imports, so an
 * upload UI can predict whether something will preview.
 */
const INLINE_IMAGE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
]);
const INLINE_TEXT = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
]);
const INLINE_MEDIA = new Set([
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/ogg",
]);

/**
 * Objects written outside this app (or before content types were recorded)
 * arrive with no type at all — fall back to the key's extension, still only
 * ever resolving to something on the inline whitelist.
 */
const EXTENSION_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** The type to serve with, or null when this object must not render inline. */
export function inlineContentType(
  contentType: string | undefined,
  key: string,
): string | null {
  const declared =
    (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  const type =
    !declared || declared === "application/octet-stream"
      ? (EXTENSION_TYPE[extension] ?? declared)
      : declared;
  if (INLINE_IMAGE.has(type) || INLINE_MEDIA.has(type)) return type;
  // Served as plain text so a mislabelled document can't become markup.
  if (INLINE_TEXT.has(type)) return "text/plain; charset=utf-8";
  return null;
}

/**
 * Whether this object can be shown as a picture (a thumbnail, an `<img>`), as
 * opposed to merely being renderable — a PDF previews in a tab but is not an
 * image, and `image/svg+xml` is an image but never renders here.
 */
export function isInlineImage(
  contentType: string | undefined,
  fileName: string,
): boolean {
  const type = inlineContentType(contentType, fileName);
  return type !== null && INLINE_IMAGE.has(type);
}
