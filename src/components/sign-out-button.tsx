"use client";

import { IconLogout } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    await authClient.signOut();
    router.push("/sign-in");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      disabled={loading}
      onClick={handleSignOut}
    >
      {loading ? <Spinner /> : <IconLogout />}
    </Button>
  );
}
