"use client";

import type * as React from "react";
import { useCallback, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  /** Dialog heading — phrase as a question ("Delete this project?"). */
  title: React.ReactNode;
  /** What will happen, and whether it can be undone. */
  description?: React.ReactNode;
  /** Label for the confirming action. Defaults to "Confirm". */
  confirmLabel?: React.ReactNode;
  /** Label shown while `onConfirm` is in flight. Defaults to `confirmLabel`. */
  pendingLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /**
   * Runs on confirm. If it returns a promise, both buttons stay disabled and
   * the action shows a spinner until it settles; the dialog closes only when it
   * resolves, so a thrown/rejected action leaves the dialog open to retry.
   */
  onConfirm: () => void | Promise<void>;
  variant?: React.ComponentProps<typeof Button>["variant"];
  /**
   * Uncontrolled usage: pass the element that opens the dialog. Omit this and
   * pass `open`/`onOpenChange` to drive it from a `deleteTarget`-style state.
   */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Confirmation for a destructive or otherwise irreversible action.
 *
 * Owns the pending state for `onConfirm` so every confirmation in the app
 * behaves the same: the action button disables and swaps in a spinner, the
 * cancel button disables, and the dialog refuses to dismiss (backdrop, Esc, or
 * close) until the action settles. That last part is why this exists as a
 * primitive rather than a `loading` prop on `Button` — a half-finished delete
 * should not be dismissable out from under the user.
 */
function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  pendingLabel,
  cancelLabel = "Cancel",
  onConfirm,
  // Matches what the hand-rolled dialogs already shipped (violet primary).
  // Pass "destructive" per-site to opt into the outlined-magenta treatment.
  variant = "default",
  trigger,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      // Never let the dialog be dismissed mid-action.
      if (pending && !next) return;
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [pending, isControlled, onOpenChange],
  );

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      // Call sites often close themselves (clearing a `deleteTarget`); closing
      // again is a no-op, and this covers the ones that don't.
      if (!isControlled) setUncontrolledOpen(false);
      onOpenChange?.(false);
    } catch {
      // Leave the dialog open so the user can retry. Call sites surface the
      // error via toast; swallowing here only prevents an unhandled rejection.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? <Spinner /> : null}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { ConfirmDialog };
