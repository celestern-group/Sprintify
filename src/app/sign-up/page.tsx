import Link from "next/link";
import { WishlistRequestForm } from "@/components/auth/wishlist-request-form";
import { AuthShell } from "@/components/auth-shell";
import {
  getPlatformLockdown,
  getSignupDisabled,
  getWishlistEnabled,
} from "@/lib/platform-lockdown";
import { SignUpFormWithFallback } from "./sign-up-form";

// Reads the platform-lockdown and invite-only switches, which must never be
// served stale.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const [lockdown, signupDisabled, wishlistEnabled] = await Promise.all([
    getPlatformLockdown(),
    getSignupDisabled(),
    getWishlistEnabled(),
  ]);

  // Platform lockdown ("red button", /admin/platform): the auth layer already
  // rejects the sign-up call itself, but explain the pause up front instead of
  // letting people fill in the form and fail.
  if (lockdown.enabled) {
    return (
      <AuthShell
        title="Sign-ups paused"
        description={lockdown.message}
        footer={
          <p className="text-sm text-muted-foreground">
            <Link
              href="/sign-in"
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        }
      >
        {null}
      </AuthShell>
    );
  }

  // Invite-only mode (admin control at /admin/platform): the auth layer already
  // rejects the /sign-up/email call, but explain it up front rather than let
  // people fill in the form and fail.
  if (signupDisabled) {
    if (wishlistEnabled) return <WishlistRequestForm />;
    return (
      <AuthShell
        title="Invite only"
        description="Sign-up is by invitation only. Ask an administrator to invite you."
        footer={
          <p className="text-sm text-muted-foreground">
            <Link
              href="/sign-in"
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        }
      >
        {null}
      </AuthShell>
    );
  }

  return <SignUpFormWithFallback />;
}
