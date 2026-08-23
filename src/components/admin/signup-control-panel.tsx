"use client";

import { IconUserPlus } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { setSignupDisabled } from "@/lib/actions/platform";

export function SignupControlPanel({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle(nextDisabled: boolean) {
    setPending(true);
    try {
      await setSignupDisabled({ disabled: nextDisabled });
      toast.success(
        nextDisabled
          ? "Public sign-up disabled — invite only."
          : "Public sign-up enabled.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update sign-up setting.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconUserPlus className="size-4 text-muted-foreground" />
            <CardTitle>Public sign-up</CardTitle>
          </div>
          {disabled ? (
            <Badge variant="neutral">Invite only</Badge>
          ) : (
            <Badge variant="success">Open</Badge>
          )}
        </div>
        <CardDescription>
          When disabled, the self-serve sign-up page is closed and new people
          can only join through an organization invitation. Existing users keep
          signing in as normal.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <label
          htmlFor="signup-disabled"
          className="flex items-center justify-between gap-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Invite-only mode</span>
            <span className="text-sm text-muted-foreground">
              Turn off self-serve public sign-up.
            </span>
          </div>
          <Switch
            id="signup-disabled"
            checked={disabled}
            disabled={pending}
            onCheckedChange={toggle}
          />
        </label>
      </CardContent>
    </Card>
  );
}
