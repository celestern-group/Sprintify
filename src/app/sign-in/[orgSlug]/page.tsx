import { and, eq, ilike } from "drizzle-orm";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { SsoSignInButton } from "@/components/sso-sign-in-button";
import { db } from "@/db";
import { organization, ssoProvider, ssoProviderProfile } from "@/db/schema";

export default async function OrgSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { orgSlug } = await params;
  const { redirectTo: requestedRedirect } = await searchParams;
  const redirectTo =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/app";

  let org = (
    await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.slug, orgSlug))
      .limit(1)
  )[0];

  // Users naturally type their work email domain (e.g. "acme.com") rather
  // than the org's internal slug — fall back to matching it against the
  // domain(s) configured on the org's SSO provider(s). `domain` can hold a
  // comma-separated list for multi-domain orgs, so narrow candidates with
  // ILIKE then verify an exact segment match in JS.
  if (!org) {
    const candidates = await db
      .select({
        id: organization.id,
        name: organization.name,
        domain: ssoProvider.domain,
      })
      .from(ssoProvider)
      .innerJoin(organization, eq(organization.id, ssoProvider.organizationId))
      .where(
        and(
          ilike(ssoProvider.domain, `%${orgSlug}%`),
          // Only domains the org has proven ownership of (DNS TXT record) —
          // an unverified provider is just an unproven claim on the domain.
          eq(ssoProvider.domainVerified, true),
        ),
      );

    const match = candidates.find((candidate) =>
      candidate.domain
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .includes(orgSlug.trim().toLowerCase()),
    );
    if (match) org = { id: match.id, name: match.name };
  }

  // Only public columns — never oidcConfig/samlConfig, which hold secrets.
  const providers = org
    ? await db
        .select({
          providerId: ssoProviderProfile.providerId,
          displayName: ssoProviderProfile.displayName,
          iconKey: ssoProviderProfile.iconKey,
        })
        .from(ssoProviderProfile)
        .innerJoin(
          ssoProvider,
          eq(ssoProvider.providerId, ssoProviderProfile.providerId),
        )
        // Unverified providers are hidden — sign-in through them is blocked
        // server-side until the org completes DNS domain verification.
        .where(
          and(
            eq(ssoProviderProfile.organizationId, org.id),
            eq(ssoProvider.domainVerified, true),
          ),
        )
    : [];

  return (
    <AuthShell
      title={org ? `Sign in to ${org.name}` : "Organization not found"}
      description={
        org
          ? "Choose your identity provider to continue."
          : "We couldn't find an organization at this address."
      }
      footer={
        <p className="text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Sign in with email instead
          </Link>
        </p>
      }
    >
      {org && providers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <SsoSignInButton
              key={provider.providerId}
              providerId={provider.providerId}
              displayName={provider.displayName}
              iconKey={provider.iconKey}
              redirectTo={redirectTo}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {org
            ? "This organization hasn't configured single sign-on yet."
            : "Check the link and try again."}
        </p>
      )}
    </AuthShell>
  );
}
