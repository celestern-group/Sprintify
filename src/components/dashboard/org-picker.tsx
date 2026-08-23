"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/session";

export function OrgPicker({
  organizations,
  basePath = "/app",
}: {
  organizations: UserOrganization[];
  basePath?: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function choose(org: UserOrganization) {
    setPendingId(org.id);
    await authClient.organization.setActive({ organizationId: org.id });
    router.push(`${basePath}/${org.slug}`);
  }

  return (
    <div className="flex flex-col gap-2">
      {organizations.map((org) => (
        <Button
          key={org.id}
          variant="outline"
          className="h-auto justify-start gap-3 py-3"
          disabled={pendingId !== null}
          onClick={() => choose(org)}
        >
          <Avatar className="size-7 rounded-md">
            <AvatarImage src={org.logo ?? undefined} />
            <AvatarFallback className="rounded-md">
              {org.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{org.name}</span>
          {pendingId === org.id ? <Spinner className="ml-auto" /> : null}
        </Button>
      ))}
    </div>
  );
}
