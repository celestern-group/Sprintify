"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useTheme } from "next-themes";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

export function TurnstileWidget({
  onVerify,
}: {
  onVerify: (token: string | null) => void;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <Turnstile
      siteKey={
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY
      }
      options={{
        theme: resolvedTheme === "dark" ? "dark" : "light",
      }}
      onSuccess={onVerify}
      onExpire={() => onVerify(null)}
      onError={() => onVerify(null)}
    />
  );
}
