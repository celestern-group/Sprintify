"use client";

import { useEffect } from "react";

/**
 * TEMPORARY, dev-only (remove with the [availability] logging in
 * src/app/app/[orgSlug]/availability/page.tsx once the loop is diagnosed).
 *
 * The server logs proved the repeated requests are full document navigations
 * (`sec-fetch-mode: navigate`, no RSC/prefetch headers) rather than router
 * refetches — but the decision to hard-navigate is made in the browser, so the
 * server can't say who made it. This names the initiator:
 *
 * - "reason: reload" on load means the document was reloaded rather than
 *   navigated to, which points at the dev overlay / an error recovery path.
 * - The `console.trace` on pagehide prints the JS stack when the unload is
 *   triggered synchronously by script (a window.location assignment), and
 *   prints nothing useful when the user clicked a link — which is itself the
 *   answer.
 * - Patching pushState/replaceState catches the router doing a soft navigation
 *   first, so a hard navigation that follows one is visibly a fallback.
 */
export function DevNavigationDebug() {
  useEffect(() => {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    console.log("[nav] document loaded", {
      url: window.location.pathname,
      reason: entry?.type,
      redirectCount: entry?.redirectCount,
    });

    const onPageHide = (event: PageTransitionEvent) => {
      console.trace("[nav] leaving", window.location.pathname, {
        persisted: event.persisted,
      });
    };
    const onBeforeUnload = () => {
      console.trace("[nav] beforeunload", window.location.pathname);
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    const { pushState, replaceState } = window.history;
    window.history.pushState = function patchedPushState(...args) {
      console.trace("[nav] pushState", args[2]);
      return pushState.apply(this, args);
    };
    window.history.replaceState = function patchedReplaceState(...args) {
      console.trace("[nav] replaceState", args[2]);
      return replaceState.apply(this, args);
    };

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
    };
  }, []);

  return null;
}
