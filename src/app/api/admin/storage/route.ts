import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import {
  BodyTooLargeError,
  readLimitedFormData,
} from "@/lib/request-body-limit";
import { requireAdminAction } from "@/lib/session";
import { storage } from "@/lib/storage";
import { inlineContentType } from "@/lib/storage/inline-types";
import { assertSafeStorageKey, normalizeFolderPath } from "@/lib/storage/keys";
import { MAX_UPLOADS_PER_REQUEST } from "@/lib/storage/upload-limits";
import {
  MAX_UPLOAD_BYTES,
  normalizeContentType,
  sanitizeFileName,
} from "@/lib/storage/uploads";

export const runtime = "nodejs";

/**
 * Largest body this route will buffer, enforced while the body streams in — the
 * per-file cap below can only run once `formData()` has materialized every
 * part, so on its own it bounds nothing. Sized to what the route would accept
 * anyway: a full batch of max-size files plus slack for multipart boundaries,
 * part headers and the `path`/`overwrite` fields.
 */
const MAX_REQUEST_BYTES =
  MAX_UPLOADS_PER_REQUEST * MAX_UPLOAD_BYTES + 1024 * 1024;

/**
 * Serves one raw object by key, for the platform-admin storage browser. Unlike
 * a registry download this addresses the store directly, so it also serves
 * objects that have no database row at all (orphans), and never exposes the
 * store's own URL.
 *
 * Defaults to an attachment. `?inline=1` renders in the browser instead, but
 * only for the types on the shared whitelist (src/lib/storage/inline-types.ts)
 * and still under `sandbox` + `nosniff`, so a hostile upload cannot execute in
 * the app's origin.
 */
export async function GET(request: Request) {
  const session = await requireAdminAction().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  try {
    assertSafeStorageKey(key);
  } catch {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const object = await storage().get(key);
  if (!object) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The download name is the last key segment, flattened to ASCII: raw keys
  // are not user-facing filenames and must not shape a header.
  const fallbackName =
    (key.split("/").pop() ?? "object").replace(/[^\w.-]/g, "_") || "object";

  const wantsInline = url.searchParams.get("inline") === "1";
  const inlineType = wantsInline
    ? inlineContentType(object.contentType, key)
    : null;
  if (wantsInline && !inlineType) {
    return NextResponse.json(
      { error: "This object cannot be previewed." },
      { status: 415 },
    );
  }

  return new NextResponse(object.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        inlineType ?? object.contentType ?? "application/octet-stream",
      "Content-Length": String(object.body.byteLength),
      "Content-Disposition": inlineType
        ? `inline; filename="${fallbackName}"`
        : `attachment; filename="${fallbackName}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Uploads one or more files into a folder of the object store, for the admin
 * explorer. A route handler rather than a server action because uploads are
 * multipart bodies far larger than the server-action body limit; every other
 * explorer mutation lives in src/lib/actions/admin-explorer.ts.
 *
 * The key is the folder plus the sanitized filename — this screen is a view of
 * the store itself, so what an admin drops into a folder keeps its own name
 * rather than becoming an opaque id.
 */
export async function POST(request: Request) {
  const session = await requireAdminAction().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  let formData: FormData | null;
  try {
    formData = await readLimitedFormData(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }

  const files = formData
    ?.getAll("file")
    .filter((entry) => entry instanceof File);
  if (!files?.length) {
    return NextResponse.json(
      { error: "Expected at least one `file` field." },
      { status: 400 },
    );
  }
  if (files.length > MAX_UPLOADS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Upload at most ${MAX_UPLOADS_PER_REQUEST} files at a time.` },
      { status: 413 },
    );
  }

  let path: string;
  try {
    const raw = formData?.get("path");
    path = normalizeFolderPath(typeof raw === "string" ? raw : "");
  } catch {
    return NextResponse.json({ error: "Invalid folder." }, { status: 400 });
  }

  const overwrite = formData?.get("overwrite") === "true";
  const written: string[] = [];

  for (const file of files) {
    if (file.size === 0) {
      return NextResponse.json(
        { error: `"${file.name}" is empty.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" is larger than 100 MB.` },
        { status: 413 },
      );
    }

    const key = `${path}${sanitizeFileName(file.name)}`;
    try {
      assertSafeStorageKey(key);
    } catch {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    if (!overwrite) {
      // Cheaper than fetching the bytes just to learn the key is taken.
      const existing = await storage().list({ prefix: key, limit: 1 });
      if (existing.objects.some((object) => object.key === key)) {
        return NextResponse.json(
          { error: `"${key}" already exists.`, code: "exists" },
          { status: 409 },
        );
      }
    }

    await storage().put(
      key,
      new Uint8Array(await file.arrayBuffer()),
      normalizeContentType(file.type),
    );

    written.push(key);
  }

  await recordAudit({
    action: "storage_object.uploaded",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "storage_path",
    targetId: path || "/",
    metadata: { objects: written.length, keys: written.slice(0, 20) },
  });

  return NextResponse.json({ keys: written });
}
