import "server-only";

/**
 * A hard ceiling on the bytes a route will buffer, enforced WHILE the body
 * streams in rather than after it has landed.
 *
 * `request.formData()` materializes every part before any per-file check can
 * run, so a route that parses first and checks second has already spent the
 * memory (and, once undici spills, the disk) by the time it says no. A
 * `Content-Length` guard in front of the parse is not enough on its own: the
 * header is absent on a chunked body and is client-supplied either way — so it
 * is kept as the cheap early exit, and the counting stream below is what
 * actually holds the line.
 *
 * A reverse-proxy body limit still belongs in front of the app. This is the
 * floor, not a replacement for it.
 */
export class BodyTooLargeError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super("That upload is too large.");
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

/**
 * Parse a multipart body, refusing to buffer more than `maxBytes` of it.
 *
 * Throws `BodyTooLargeError` when the body exceeds the cap — either as declared
 * by `Content-Length` (no bytes read at all) or as counted off the wire (the
 * stream is errored, so undici stops reading and releases what it holds).
 * Returns `null` when the body is not parseable form data, which callers answer
 * with a 400 the same way `request.formData().catch(() => null)` did.
 */
export async function readLimitedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }

  const body = request.body;
  if (!body) return null;

  // Tracked out here rather than read back off the rejection: the error we
  // raise inside the transform reaches `formData()` wrapped by undici, so its
  // identity is not something to match on.
  let exceeded = false;
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        exceeded = true;
        controller.error(new BodyTooLargeError(maxBytes));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  // Content-Type carries the multipart boundary and must survive; Content-Length
  // must not — it describes the original body, and re-declaring it over a stream
  // the parser may never see the end of is a mismatch waiting to happen.
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  const limited = new Request(request.url, {
    method: request.method,
    headers,
    body: body.pipeThrough(counter),
    // Streaming a request body requires half-duplex; not yet in lib.dom's types.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  try {
    return await limited.formData();
  } catch {
    if (exceeded) throw new BodyTooLargeError(maxBytes);
    return null;
  }
}
