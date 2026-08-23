"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { AccountsCard } from "@/components/profile/accounts-card";
import { ApiKeysCard } from "@/components/profile/api-keys-card";
import { DangerZoneCard } from "@/components/profile/danger-zone-card";
import { EmailCard } from "@/components/profile/email-card";
import { PasswordCard } from "@/components/profile/password-card";
import { ProfileInfoCard } from "@/components/profile/profile-info-card";
import { SessionsCard } from "@/components/profile/sessions-card";
import { TwoFactorCard } from "@/components/profile/two-factor-card";
import type { ProfileAccount } from "@/components/profile/types";
import { authClient } from "@/lib/auth-client";

export function ProfilePanel({
  user,
  currentSessionToken,
}: {
  user: {
    name: string;
    email: string;
    emailVerified: boolean;
    image: string;
    twoFactorEnabled: boolean;
  };
  currentSessionToken: string;
}) {
  const [accounts, setAccounts] = useState<ProfileAccount[] | null>(null);

  const loadAccounts = useCallback(() => {
    authClient.listAccounts().then(({ data }) => {
      setAccounts(data ?? []);
    });
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const hasPassword =
    accounts?.some((account) => account.providerId === "credential") ?? false;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Manage your personal information, security, and account access."
      />

      <ProfileInfoCard initialName={user.name} initialImage={user.image} />
      <EmailCard
        initialEmail={user.email}
        initialVerified={user.emailVerified}
      />

      {accounts === null ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : (
        <>
          <PasswordCard email={user.email} hasPassword={hasPassword} />
          {hasPassword ? (
            <TwoFactorCard initialEnabled={user.twoFactorEnabled} />
          ) : null}
          <SessionsCard currentSessionToken={currentSessionToken} />
          <ApiKeysCard />
          <AccountsCard accounts={accounts} onChanged={loadAccounts} />
        </>
      )}

      <DangerZoneCard email={user.email} />
    </PageContainer>
  );
}
