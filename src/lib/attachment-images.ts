// Inline images in prose: which `src` values the app will ever render, and how
// a pasted screenshot becomes a file.
//
// Client-safe on purpose (no db, no storage, no "use server"): the sanitizer
// that decides what an `<img>` may point at and the editor that writes one have
// to agree on exactly one rule, and they live on opposite sides of the wire.
//
// The rule is narrow by design. A prose field stores markdown that anyone with
// project access can write, so an unrestricted `![](…)` is an outbound request
// made by every READER of the item — a tracking pixel that reports who opened
// which ticket and from where, to a host the author chose. Confining `src` to
// our own attachment route removes that entirely: the bytes are ours, the route
// re-checks `backlog:view` per reader, and an image someone may not see 404s
// instead of leaking that it exists.

/**
 * The one shape an inline image may have: the attachment download route in
 * preview mode, relative and same-origin.
 *
 * Anchored at `^/`, so a protocol-relative `//evil.example` or an absolute URL
 * can never match — a browser resolves both off-origin. Ids are matched as
 * opaque tokens rather than as UUIDs: the route resolves them against the
 * database anyway, and a stricter pattern here would only mean a future id
 * format silently loses its pictures.
 */
const ATTACHMENT_IMAGE_SRC =
  /^\/api\/work-items\/[A-Za-z0-9_-]+\/attachments\/[A-Za-z0-9_-]+\?inline=1$/;

/** Whether this `src` is one of our own attachment previews. */
export function isAttachmentImageSrc(src: string | undefined): boolean {
  return typeof src === "string" && ATTACHMENT_IMAGE_SRC.test(src);
}

/**
 * The image files on a clipboard/drag payload, renamed when the clipboard did
 * not name them.
 *
 * A screenshot pasted from the OS arrives as `image.png` (or with no name at
 * all), so a person who pastes four of them ends up with four identically
 * named rows in the Attachments tab and no way to tell which is which. The
 * timestamp is taken from the paste, which is the only thing that distinguishes
 * them.
 *
 * `kind === "file"` alone is not enough: copying a cell out of a spreadsheet
 * puts an image/png rendering of it on the clipboard alongside the text, and
 * only the type tells the two apart.
 */
export function imageFilesFrom(
  data: DataTransfer | null,
  /** Stamped into generated names — passed in so callers can keep it testable. */
  now: Date = new Date(),
): File[] {
  if (!data) return [];
  return Array.from(data.files)
    .filter((file) => file.type.startsWith("image/"))
    .map((file, index) =>
      isGenericImageName(file.name)
        ? new File([file], pastedImageName(file, now, index), {
            type: file.type,
            lastModified: file.lastModified,
          })
        : file,
    );
}

/** Whether the clipboard named this file anything worth keeping. */
function isGenericImageName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed === "" || /^image\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(trimmed)
  );
}

function pastedImageName(file: File, now: Date, index: number): string {
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19);
  const extension =
    file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  // The index only matters when one paste carries several images; it keeps them
  // apart inside the same second.
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `pasted-image-${stamp}${suffix}.${extension}`;
}
