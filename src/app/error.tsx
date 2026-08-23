"use client";

import * as Sentry from "@sentry/nextjs";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    trackEvent("app.error");
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center shadow-card">
        <div className="grid size-11 place-items-center rounded-md bg-chip text-destructive">
          <IconAlertTriangle className="size-5" />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-destructive">
          Error
        </div>
        <h1 className="font-heading text-xl font-extrabold tracking-tight">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, and if it keeps
          happening, contact support.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button
          onClick={() => {
            trackEvent("app.error_retry");
            reset();
          }}
          className="mt-2"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
