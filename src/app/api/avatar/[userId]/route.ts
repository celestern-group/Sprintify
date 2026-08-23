import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { avatarKey } from "@/lib/storage/avatar";

export const runtime = "nodejs";

/**
 * Streams a user's avatar from storage. Requires a signed-in session (avatars
 * are shown across a user's organizations, so any authenticated user may view
 * one), and never exposes the underlying storage URL — the bytes are proxied.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;
  const object = await storage().get(avatarKey(userId));
  if (!object) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(object.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": object.contentType ?? "application/octet-stream",
      "Content-Length": String(object.body.byteLength),
      // Private: cacheable per-browser only. The `?v=` on the URL busts this
      // when the avatar changes, so a long max-age is safe.
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
