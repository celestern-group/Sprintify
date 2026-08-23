// Pure helpers only — the create dialog imports these on the client. The
// database-backed allocation lives in src/lib/project-access.ts.

export const PROJECT_KEY_MAX_LENGTH = 10;
export const PROJECT_KEY_MIN_LENGTH = 2;
// Uppercase alphanumeric, leading letter — so a key never collides with a
// numeric id and always reads as a word in a URL.
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const PROJECT_KEY_FORMAT_MESSAGE =
  "Project key must be 2–10 letters or numbers and start with a letter.";

/** Strips anything the key can't contain. Used on both client and server. */
export function normalizeProjectKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PROJECT_KEY_MAX_LENGTH);
}

/**
 * Suggests a key from a project name: initials for multi-word names
 * ("Marketing site redesign" -> "MSR"), the word itself for single-word ones
 * ("Website" -> "WEBSITE"). Only a suggestion — the caller may override it.
 */
export function deriveProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const raw =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "");

  let key = raw.slice(0, PROJECT_KEY_MAX_LENGTH);
  // A leading digit is legal in a name but not in a key; keep the characters
  // rather than dropping them, so "2024 roadmap" stays recognisable as P2R.
  if (/^[0-9]/.test(key)) {
    key = `P${key}`.slice(0, PROJECT_KEY_MAX_LENGTH);
  }
  return key.length >= PROJECT_KEY_MIN_LENGTH ? key : "PROJ";
}
