// Where a navigation CAME from, carried in the URL.
//
// A work item is reachable from half a dozen surfaces — the ranked backlog, the
// board, the table, the gantt, the project overview, a relation link, an AI
// result, the notification bell — and every one of them used to hand back the
// same "Back to backlog". That threw away the screen the reader was on and, on
// the backlog itself, the view they had picked.
//
// The origin travels as a query param rather than as component state because it
// has to survive the two things people actually do with an item page: reload it
// and paste it into chat. Browser back would cover the first case only, and
// only while the tab's history still holds the entry.
//
// It is client-safe (no db/server imports) so the links that WRITE the param
// and the pages that READ it share one definition of what a legal origin is.

import {
  BACKLOG_VIEW_LABELS,
  type BacklogView,
  isBacklogView,
} from "@/lib/work-items";

/** The query key. Short, because it rides on every item link. */
export const RETURN_TO_PARAM = "from";

/**
 * Longest origin we will echo back into a link. A real one is well under this;
 * the cap is there because the value arrives from the address bar, and a
 * megabyte of query string is not a navigation.
 */
const MAX_RETURN_TO_LENGTH = 512;

/**
 * Turn whatever arrived in `?from=` into a path this app may navigate to, or
 * `null` to fall back to the caller's default.
 *
 * Two separate jobs, and both are load-bearing:
 *
 * 1. It must be a same-origin RELATIVE path. Anything a browser would read as
 *    an absolute or protocol-relative URL (`https://…`, `//evil.example`,
 *    `/\evil.example`) is refused, so a crafted item link can't turn our own
 *    back button into an open redirect.
 * 2. It must sit under one of `allowedPrefixes` — the caller passes the org's
 *    own routes, so a link mailed between orgs can't point someone's back
 *    button at a tenant they didn't come from.
 */
export function sanitizeReturnTo(
  raw: string | string[] | undefined | null,
  allowedPrefixes: readonly string[],
): string | null {
  // A repeated `?from=` is never something we wrote; take neither value rather
  // than guessing which one the reader meant.
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_RETURN_TO_LENGTH) return null;
  if (!raw.startsWith("/")) return null;
  // `//host` and `/\host` are both absolute URLs to a browser.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;

  let parsed: URL;
  try {
    // The base is a throwaway: only the path/query/hash are read back out, so
    // any authority smuggled into the value is dropped here rather than tested
    // for by hand.
    parsed = new URL(raw, "https://return-to.invalid");
  } catch {
    return null;
  }

  const params = new URLSearchParams(parsed.search);
  // An origin never carries its own origin. Without this a round trip through
  // two item pages would nest `from` inside `from` until the URL hit the cap.
  params.delete(RETURN_TO_PARAM);
  const query = params.toString();

  const path = parsed.pathname;
  const allowed = allowedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!allowed) return null;

  return `${path}${query ? `?${query}` : ""}${parsed.hash}`;
}

/** `href` with the origin attached — the one way item links are composed. */
export function withReturnTo(href: string, returnTo: string | null): string {
  if (!returnTo) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/**
 * What the back link should SAY. "Back" is honest but useless when the reader
 * arrived from the board and the sprint page and the overview all in one
 * session — naming the destination is what makes the link a promise.
 *
 * `basePath` is the project root (`/app/[orgSlug]/[projectKey]`), so the same
 * origin reads correctly in every project without a lookup.
 */
export function describeReturnTo(returnTo: string, basePath: string): string {
  const [path, query = ""] = returnTo.split("#")[0].split("?");
  const view = new URLSearchParams(query).get("view");

  if (path === `${basePath}/backlog`) return backlogLabel(view);
  if (path === `${basePath}/board`) return "Back to board";
  if (path === `${basePath}/sprints`) return "Back to sprints";
  if (path.startsWith(`${basePath}/sprints/`)) return "Back to sprint";
  if (path === `${basePath}/availability`) return "Back to availability";
  if (path === `${basePath}/workflow`) return "Back to workflow";
  if (path === basePath) return "Back to project";
  // `/app/[orgSlug]` — the org dashboard, two segments deep.
  if (
    path.split("/").filter(Boolean).length === 2 &&
    path.startsWith("/app/")
  ) {
    return "Back to dashboard";
  }
  return "Back";
}

/** The four backlog views share one route, so the label comes from `?view=`. */
function backlogLabel(view: string | null): string {
  if (!isBacklogView(view) || view === "backlog") return "Back to backlog";
  return `Back to ${BACKLOG_VIEW_LABELS[view as BacklogView].toLowerCase()}`;
}

/**
 * The routes an origin may point at, for an item page in one org: that org's
 * app shell and its management shell. Both are real places to have clicked an
 * item from (the notification bell renders in each), and nothing else is.
 */
export function orgReturnToPrefixes(orgSlug: string): readonly string[] {
  return [`/app/${orgSlug}`, `/manage-org/${orgSlug}`];
}
