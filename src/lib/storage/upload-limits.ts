/**
 * Upload limits both sides of the wire need to agree on.
 *
 * Separate from `uploads.ts` because that module is `server-only` (it also
 * holds key/filename sanitization), while the explorer has to know how many
 * files to put in one request — an uploader that batched by a different number
 * than the route accepts just earns a 413 with the files already read.
 */

/**
 * Files one admin-explorer upload request may carry. Bounds what the route
 * buffers per request (this many × `MAX_UPLOAD_BYTES`); a bigger drop is split
 * into several requests by the client.
 */
export const MAX_UPLOADS_PER_REQUEST = 5;
