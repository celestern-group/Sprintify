"use client";

import { IconAlertOctagon, IconLockOpen2 } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { setPlatformLockdown } from "@/lib/actions/platform";

const BLOCKED_WHILE_LOCKED = [
  "New user sign-ups — email, SSO auto-provisioning, and invite provisioning",
  "New organizations — self-serve and admin-created",
  "New projects and teams",
  "Member invitations",
];

export function PlatformLockdownPanel({
  enabled,
  message,
  enabledAt,
}: {
  enabled: boolean;
  /** Resolved user-facing message (admin-set or the platform default). */
  message: string;
  enabledAt: string | null;
}) {
  const router = useRouter();
  const [customMessage, setCustomMessage] = useState("");

  async function activate() {
    try {
      await setPlatformLockdown({ enabled: true, message: customMessage });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to activate lockdown.",
      );
      throw error;
    }
    toast.warning("Platform lockdown activated.");
    setCustomMessage("");
    router.refresh();
  }

  async function lift() {
    try {
      await setPlatformLockdown({ enabled: false });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to lift the lockdown.",
      );
      throw error;
    }
    toast.success("Lockdown lifted — sign-ups and creation are open again.");
    router.refresh();
  }

  return (
    <Card className="border border-danger-border">
      <CardHeader className="border-b border-danger-border [.border-b]:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-destructive">
            <IconAlertOctagon className="size-4" />
            <CardTitle className="text-destructive">
              Platform lockdown
            </CardTitle>
          </div>
          {enabled ? (
            <Badge variant="destructive">Lockdown active</Badge>
          ) : (
            <Badge variant="success">Platform open</Badge>
          )}
        </div>
        <CardDescription>
          The red button. Freezes everything new across the whole platform while
          you handle an incident — existing users keep signing in and working as
          normal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            Blocked while active
          </p>
          <ul className="flex flex-col gap-1.5">
            {BLOCKED_WHILE_LOCKED.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-destructive"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {enabled ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-danger-tint p-4">
              <p className="text-sm font-semibold text-destructive">
                Lockdown is active
                {enabledAt
                  ? ` since ${new Date(enabledAt).toLocaleString()}`
                  : ""}
                .
              </p>
              <p className="mt-1 text-sm text-foreground">
                People who try to sign up or create something see:
                <span className="mt-1 block font-semibold text-foreground">
                  “{message}”
                </span>
              </p>
            </div>
            <div>
              <ConfirmDialog
                trigger={
                  <Button data-icon="inline-start">
                    <IconLockOpen2 />
                    Lift lockdown
                  </Button>
                }
                title="Lift the platform lockdown?"
                description="Sign-ups, organizations, projects, teams, and invitations open back up immediately for everyone."
                confirmLabel="Lift lockdown"
                pendingLabel="Lifting..."
                onConfirm={lift}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="lockdown-message">
                Message shown to users (optional)
              </FieldLabel>
              <Textarea
                id="lockdown-message"
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder={message}
              />
            </Field>
            <div>
              <ConfirmDialog
                trigger={
                  <Button variant="destructive" data-icon="inline-start">
                    <IconAlertOctagon />
                    Activate lockdown
                  </Button>
                }
                title="Freeze all new sign-ups and creation?"
                description="Nobody — including admins — can create users, organizations, projects, teams, or invitations until the lockdown is lifted. Existing users can keep signing in and working."
                confirmLabel="Activate lockdown"
                pendingLabel="Activating..."
                variant="destructive"
                onConfirm={activate}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
