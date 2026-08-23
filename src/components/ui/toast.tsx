"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { type ExternalToast, toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * The app imports `toast` from HERE, never from `sonner` directly.
 *
 * An error message is the one toast a person needs to hand to someone else —
 * support asks "what did it say", and re-triggering the failure to read it
 * again is not a thing anyone should have to do. So every `toast.error` grows
 * a copy button, centrally, rather than at 130-odd call sites that would each
 * have to remember.
 *
 * The button is a real element (sonner renders a `React.isValidElement`
 * action verbatim), which is also what keeps the toast on screen: sonner's own
 * `{label, onClick}` action button dismisses the toast after the click, and
 * the message has to still be readable while the copy is being pasted.
 */

const COPIED_FEEDBACK_MS = 1600;

/** The text a reader would want to paste: the message, plus its description. */
function copyableText(message: unknown, data?: ExternalToast): string | null {
  const lines: string[] = [];
  if (typeof message === "string") lines.push(message);
  else if (typeof message === "number") lines.push(String(message));
  if (typeof data?.description === "string") lines.push(data.description);
  const text = lines.join("\n").trim();
  return text === "" ? null : text;
}

function CopyMessageButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Insecure context or a denied permission — say so rather than claiming
      // a copy that never happened; the message stays selectable either way.
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPIED_FEEDBACK_MS);
  }

  const label =
    state === "copied"
      ? "Copied"
      : state === "failed"
        ? "Unable to copy"
        : "Copy";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${label} error message`}
      className={cn(
        "ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-2 text-xs font-semibold",
        "text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      )}
    >
      {state === "copied" ? <IconCheck /> : <IconCopy />}
      {/* The confirmation is announced, not just coloured in. */}
      <span aria-live="polite">{label}</span>
    </button>
  );
}

function errorToast(
  message: Parameters<typeof sonnerToast.error>[0],
  data?: ExternalToast,
) {
  // A call site that supplies its own action (a retry, say) keeps it.
  if (data?.action !== undefined) return sonnerToast.error(message, data);
  const text = copyableText(message, data);
  if (!text) return sonnerToast.error(message, data);
  return sonnerToast.error(message, {
    ...data,
    action: <CopyMessageButton text={text} />,
  });
}

/**
 * `sonner`'s `toast` is a callable built with `Object.assign`, so its methods
 * copy across; only `error` is replaced.
 */
export const toast: typeof sonnerToast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  { error: errorToast },
);
