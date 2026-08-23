"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { Suspense, useEffect, useRef } from "react";
import { env } from "@/env";
import { trackEvent } from "@/lib/analytics";

function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPath = useRef<string>("");

  useEffect(() => {
    const query = searchParams?.toString();
    const fullPath = query ? `${pathname}?${query}` : pathname;

    if (fullPath && fullPath !== lastTrackedPath.current) {
      lastTrackedPath.current = fullPath;
      trackEvent("route_change", { path: pathname });
    }
  }, [pathname, searchParams]);

  return null;
}

export function UmamiAnalytics() {
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) {
    return null;
  }

  const scriptUrl =
    env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js";
  const domains = env.NEXT_PUBLIC_UMAMI_DOMAINS;

  return (
    <>
      <Script
        src={scriptUrl}
        data-website-id={websiteId}
        data-auto-track="true"
        {...(domains ? { "data-domains": domains } : {})}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <RouteTracker />
      </Suspense>
    </>
  );
}
