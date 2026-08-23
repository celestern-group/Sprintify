import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  // The 2FA challenge runs after password verification but before a full
  // session cookie is issued, so it must be reachable without one.
  "/two-factor",
  // PWA assets must be reachable without a session: the web app manifest, the
  // Serwist service worker (served from /serwist/*), and the offline fallback.
  "/manifest.webmanifest",
  "/serwist",
  "/~offline",
];

function isPublicPath(pathname: string) {
  // Dev-only design-system reference; the page itself 404s in production.
  if (process.env.NODE_ENV === "development" && pathname === "/styleguide") {
    return true;
  }
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Signed-in users being bounced away from the marketing home page and the
  // login form (straight to /app) is handled in those pages themselves via
  // the authoritative, DB-backed session check (`getSession`) — not here.
  // `getSessionCookie` below only parses the cookie's shape; it can't tell a
  // valid session from a stale one (expired, revoked, or otherwise deleted
  // from the DB while the cookie is still sitting in the browser). Using it
  // to redirect *away* from /sign-in previously meant a stale cookie could
  // never reach the sign-in form: /app -> (session invalid) -> /sign-in ->
  // (cookie still present) -> /app, forever. It's still safe to use here for
  // the opposite direction — gating private routes from clearly-signed-out
  // (no cookie at all) traffic — since that can't loop: a request with no
  // cookie sent to /sign-in just renders the form.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
};
