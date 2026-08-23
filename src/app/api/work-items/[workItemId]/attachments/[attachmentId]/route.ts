import { NextResponse } from "next/server";
import { requireProjectPermission } from "@/lib/project-access";
import { storage } from "@/lib/storage";
import { inlineContentType } from "@/lib/storage/inline-types";
import { loadAttachmentOrThrow } from "@/lib/work-item-attachment-access";

// Serves one attachment's bytes.
//
// The store is never exposed: no signed URLs, no bucket hostnames, no
// public objects — every read goes through this handler so it can be gated on
// backlog:view for the project the STORED row belongs to. That also means a
// link pasted into chat keeps working exactly as long as the reader's access
// does, which is the property a signed URL cannot have.
//
// The workItemId in the path is checked against the row rather than trusted:
// it makes the URL readable and cacheable per item, but the attachment id is
// what resolves the object.

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workItemId: string; attachmentId: string }> },
) {
  const { workItemId, attachmentId } = await params;

  let attachment: Awaited<ReturnType<typeof loadAttachmentOrThrow>>;
  try {
    attachment = await loadAttachmentOrThrow(attachmentId);
    if (attachment.workItemId !== workItemId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await requireProjectPermission(
      attachment.organizationId,
      attachment.projectId,
      "backlog:view",
      { project: ["update"] },
      "You don't have permission to view this project's backlog.",
    );
  } catch {
    // One status for "no such file" and "not yours": a 403 here would confirm
    // an id exists to someone who may not know that.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const object = await storage().get(attachment.storageKey);
  if (!object) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const wantsInline = url.searchParams.get("inline") === "1";
  const inlineType = wantsInline
    ? inlineContentType(
        object.contentType ?? attachment.contentType,
        attachment.fileName,
      )
    : null;
  if (wantsInline && !inlineType) {
    return NextResponse.json(
      { error: "This file cannot be previewed." },
      { status: 415 },
    );
  }

  // The download name is the row's name, flattened to ASCII: a header may not
  // carry raw UTF-8, and `filename*` would still need the plain form as a
  // fallback. RFC 5987 form is added so a non-Latin name survives.
  const asciiName =
    attachment.fileName.replace(/[^\w.\- ]/g, "_").trim() || "file";
  const disposition = `${inlineType ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`;

  return new NextResponse(object.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        inlineType ?? object.contentType ?? "application/octet-stream",
      "Content-Length": String(object.body.byteLength),
      "Content-Disposition": disposition,
      // Private: the response is authorized per reader, so no shared cache may
      // hold it. The immutable hint is safe because the bytes behind an
      // attachment id never change (a rename doesn't touch the object).
      "Cache-Control": "private, max-age=0, must-revalidate",
      // Even a whitelisted inline type renders with nothing it can reach and no
      // origin it can act as.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
