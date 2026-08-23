import { ProfilePanel } from "@/components/profile/profile-panel";
import { requireAuth } from "@/lib/session";

export default async function ProfilePage() {
  const session = await requireAuth();

  return (
    <ProfilePanel
      user={{
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? "",
        twoFactorEnabled: session.user.twoFactorEnabled ?? false,
      }}
      currentSessionToken={session.session.token}
    />
  );
}
