"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import "./globals.css";

/**
 * Runs before paint so the crash screen matches the user's theme: reads the
 * next-themes localStorage key and falls back to the OS preference when the
 * value is "system" or absent.
 */
const THEME_SCRIPT = `
try {
  var theme = localStorage.getItem("theme");
  if (
    theme === "dark" ||
    ((!theme || theme === "system") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    trackEvent("app.global_error");
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center shadow-card">
            <h1 className="font-heading text-xl font-extrabold tracking-tight">
              Something went wrong
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              A critical error occurred. Please try again.
            </p>
            <button
              type="button"
              onClick={() => {
                trackEvent("app.global_error_retry");
                reset();
              }}
              className="mt-2 inline-flex h-8 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
