import { getSignupDisabled } from "@/lib/platform-lockdown";
import { AcceptInvitationForm } from "./accept-invitation-form";

// Reads the invite-only switch (to show/hide the "Create account" option),
// which must never be served stale.
export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage() {
  const signupDisabled = await getSignupDisabled();

  return <AcceptInvitationForm signUpEnabled={!signupDisabled} />;
}
