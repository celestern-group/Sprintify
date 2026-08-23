"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProfileAccount } from "@/components/profile/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

function providerLabel(providerId: string) {
  if (providerId === "credential") return "Email & password";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

export function AccountsCard({
  accounts,
  onChanged,
}: {
  accounts: ProfileAccount[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  async function unlink(account: ProfileAccount) {
    setUnlinkingId(account.id);
    const { error } = await authClient.unlinkAccount({
      providerId: account.providerId,
      accountId: account.accountId,
    });
    setUnlinkingId(null);

    if (error) {
      if (error.message === "Session is not fresh") {
        toast.error("Unlinking needs a more recent sign-in.", {
          action: {
            label: "Sign in",
            onClick: () => router.push("/sign-in?redirectTo=/profile"),
          },
        });
        return;
      }
      toast.error(error.message ?? "Unable to unlink account.");
      return;
    }

    toast.success(`${providerLabel(account.providerId)} unlinked.`);
    onChanged();
  }

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>
          Sign-in methods linked to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-6">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span className="min-w-0 truncate font-medium">
              {providerLabel(account.providerId)}
            </span>
            {accounts.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={unlinkingId === account.id}
                onClick={() => unlink(account)}
              >
                Unlink
              </Button>
            ) : null}
          </div>
        ))}
        {accounts.length <= 1 ? (
          <p className="text-sm text-muted-foreground">
            This is your only sign-in method, so it can&apos;t be unlinked.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
