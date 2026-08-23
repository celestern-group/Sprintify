"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

export function DangerZoneCard({ email }: { email: string }) {
  const [requested, setRequested] = useState(false);

  async function remove() {
    const { error } = await authClient.deleteUser({
      callbackURL: "/sign-in",
    });

    if (error) {
      toast.error(error.message ?? "Unable to delete account.");
      return;
    }

    toast.success(`Check ${email} for a link to confirm deletion.`);
    setRequested(true);
  }

  return (
    <Card className="border border-danger-border">
      <CardHeader className="border-b border-danger-border [.border-b]:pb-6">
        <div className="flex items-center gap-2 text-destructive">
          <IconAlertTriangle className="size-4" />
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </div>
        <CardDescription>Irreversible account actions.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Delete your account</p>
            <p className="text-sm text-muted-foreground">
              {requested
                ? `We sent a confirmation link to ${email}. Your account is deleted once you approve it.`
                : "Permanently deletes your account and all its data. This cannot be undone."}
            </p>
          </div>
          {requested ? null : (
            <ConfirmDialog
              trigger={
                <Button variant="destructive" className="shrink-0">
                  Delete account
                </Button>
              }
              title="Delete your account?"
              description={
                <>
                  We&apos;ll email a confirmation link to {email}. Your account,
                  memberships, and data are permanently deleted once you approve
                  it. This cannot be undone.
                </>
              }
              confirmLabel="Send confirmation"
              pendingLabel="Sending..."
              variant="destructive"
              onConfirm={remove}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
