import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSignupDisabled, getWishlistEnabled } from "@/lib/platform-lockdown";
import { getSession } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

// Reads the invite-only switch (to show/hide the "Sign up" link), which must
// never be served stale.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const session = await getSession();

  if (session) {
    const { redirectTo } = await searchParams;
    const target =
      redirectTo?.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : "/app";
    redirect(target);
  }

  const [signupDisabled, wishlistEnabled] = await Promise.all([
    getSignupDisabled(),
    getWishlistEnabled(),
  ]);

  return (
    <Suspense>
      <SignInForm
        signUpEnabled={!signupDisabled}
        requestAccessEnabled={signupDisabled && wishlistEnabled}
      />
    </Suspense>
  );
}
