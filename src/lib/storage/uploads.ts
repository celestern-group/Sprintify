import "server-only";

/** Max size of one uploaded object (bytes). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/** Longest filename we will store as a key segment. */
export const MAX_FILE_NAME = 255;

/**
 * Strip a client-supplied filename down to something safe to store and to echo
 * back in a `Content-Disposition` header: no path separators, no control
 * characters, no leading dots, length-capped. Returns "file" when nothing
 * usable is left.
 */
export function sanitizeFileName(name: string): string {
  const tail = name.split(/[\\/]/).pop() ?? "";
  // Drop control characters — they would let a name inject header breaks.
  const printable = Array.from(tail)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  const base = printable.replace(/^\.+/, "").trim();
  if (!base) return "file";
  return base.slice(0, MAX_FILE_NAME);
}

/**
 * Content type we persist and serve the bytes with. Browsers are told to
 * download stored objects rather than render them (see the download route), so
 * this is metadata for the admin UI, not a rendering decision — but anything
 * script-bearing is still flattened to a plain octet-stream as defence in
 * depth, and an unknown/absent type falls back the same way.
 */
export function normalizeContentType(contentType: string | undefined): string {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (!type || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) {
    return "application/octet-stream";
  }
  const dangerous = [
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/xml",
    "text/xml",
    "application/javascript",
    "text/javascript",
  ];
  return dangerous.includes(type) ? "application/octet-stream" : type;
}
