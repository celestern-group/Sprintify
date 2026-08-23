"use client";

import { IconCompass } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

export default function NotFound() {
  useEffect(() => {
    trackEvent("app.not_found", {
      path: typeof window !== "undefined" ? window.location.pathname : "",
    });
  }, []);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center shadow-card">
        <div className="grid size-11 place-items-center rounded-md bg-chip text-muted-foreground">
          <IconCompass className="size-5" />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
          404
        </div>
        <h1 className="font-heading text-xl font-extrabold tracking-tight">
          Page not found
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Button
          className="mt-2"
          nativeButton={false}
          render={
            <Link
              href="/app"
              onClick={() =>
                trackEvent("navigation.route_change", {
                  from: "404",
                  to: "/app",
                })
              }
            >
              Back to app
            </Link>
          }
        />
      </div>
    </div>
  );
}
