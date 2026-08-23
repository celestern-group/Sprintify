"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function StopImpersonatingBanner() {
  const router = useRouter();

  async function stopImpersonating() {
    await authClient.admin.stopImpersonating();
    router.push("/admin/users");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-warning-tint px-4 py-2 text-sm text-foreground">
      <span className="flex items-center gap-2">
        <IconAlertTriangle
          className="size-4 shrink-0 text-warning"
          aria-hidden
        />
        You are impersonating this user.
      </span>
      <Button size="xs" variant="outline" onClick={stopImpersonating}>
        Stop impersonating
      </Button>
    </div>
  );
}
