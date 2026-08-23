import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import {
  avatarKey,
  MAX_AVATAR_BYTES,
  sniffImageType,
} from "@/lib/storage/avatar";

export const runtime = "nodejs";

/** Browser-facing avatar URL — an internal proxy path, never a storage URL. */
function avatarUrl(userId: string) {
  return `/api/avatar/${userId}?v=${Date.now()}`;
}

/** Upload (or replace) the signed-in user's avatar. */
export async function POST(request: Request) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected a `file` field." },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "Image is too large (max 5 MB)." },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Trust the bytes, not the client-declared Content-Type.
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return NextResponse.json(
      { error: "Unsupported image format. Use JPEG, PNG, WebP, or GIF." },
      { status: 415 },
    );
  }

  const userId = session.user.id;
  await storage().put(avatarKey(userId), bytes, contentType);

  const image = avatarUrl(userId);
  await auth.api.updateUser({ headers: requestHeaders, body: { image } });

  return NextResponse.json({ image });
}

/** Remove the signed-in user's avatar. */
export async function DELETE() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  await storage().delete(avatarKey(userId));
  await auth.api.updateUser({ headers: requestHeaders, body: { image: null } });

  return NextResponse.json({ image: null });
}
