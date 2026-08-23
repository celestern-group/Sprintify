"use client";

import { IconKey } from "@tabler/icons-react";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import {
  type ProviderKind,
  SSO_PROVIDER_ICONS,
} from "@/lib/sso-provider-kinds";

export function SsoSignInButton({
  providerId,
  displayName,
  iconKey,
  redirectTo,
}: {
  providerId: string;
  displayName: string;
  iconKey: string;
  redirectTo: string;
}) {
  const [loading, setLoading] = useState(false);
  const Icon = SSO_PROVIDER_ICONS[iconKey as ProviderKind] ?? IconKey;

  async function handleClick() {
    setLoading(true);
    const { error } = await authClient.signIn.sso({
      providerId,
      callbackURL: redirectTo,
    });
    if (error) {
      toast.error(error.message ?? "Unable to start sign-in.");
      setLoading(false);
    }
    // On success the client redirects the browser to the identity provider.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-start gap-3"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? <Spinner /> : <Icon className="size-4" />}
      Continue with {displayName}
    </Button>
  );
}
