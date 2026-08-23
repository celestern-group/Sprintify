import "server-only";

/** Max avatar upload size (bytes). Avatars are small; keep this tight. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

/** Content types we accept for avatars. */
export const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedAvatarType = (typeof ALLOWED_AVATAR_TYPES)[number];

/**
 * Deterministic storage key for a user's avatar — one object per user,
 * overwritten on re-upload. Because it's derived from the id, neither route
 * needs to persist or look the key up anywhere.
 */
export function avatarKey(userId: string): string {
  return `avatars/${userId}`;
}

/**
 * Sniff the real image type from the leading magic bytes, so we don't trust the
 * client-supplied Content-Type. Returns the canonical MIME type, or `null` if
 * the bytes are not one of our allowed image formats.
 */
export function sniffImageType(bytes: Uint8Array): AllowedAvatarType | null {
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  // GIF: "GIF8"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
