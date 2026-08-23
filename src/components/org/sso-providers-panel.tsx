"use client";

import {
  IconCopy,
  IconKey,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import {
  Choicebox,
  ChoiceboxIndicator,
  ChoiceboxItem,
  ChoiceboxItemDescription,
  ChoiceboxItemHeader,
  ChoiceboxItemTitle,
} from "@/components/kibo-ui/choicebox";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  createSsoProviderProfile,
  type DiscoveredOidcEndpoints,
  discoverOidcEndpoints,
  getSsoProviderProfiles,
  updateSsoProviderProfile,
} from "@/lib/actions/sso";
import { authClient } from "@/lib/auth-client";
import {
  PROVIDER_KINDS,
  type ProviderKind,
  SSO_PROVIDER_ICONS,
} from "@/lib/sso-provider-kinds";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The DNS TXT host for domain verification is `_better-auth-token-<providerId>`
// and a DNS label maxes out at 63 chars — longer provider IDs make the domain
// unverifiable, so cap the ID at 63 - "_better-auth-token-".length.
const PROVIDER_ID_MAX_LENGTH = 44;

type SanitizedProvider = {
  providerId: string;
  type: "oidc" | "saml";
  issuer: string;
  domain: string;
  domainVerified: boolean;
  organizationId: string | null;
  oidcConfig?: {
    authorizationEndpoint?: string | null;
    tokenEndpoint?: string | null;
    userInfoEndpoint?: string | null;
    jwksEndpoint?: string | null;
  } | null;
};

type ProviderProfile = {
  providerId: string;
  displayName: string;
  iconKey: string;
};

export function SsoProvidersPanel({ slug }: { slug: string }) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [providers, setProviders] = useState<SanitizedProvider[]>([]);
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SanitizedProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<{
    providerId: string;
    domain: string;
  } | null>(null);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProviderKind>("google");
  const [tenant, setTenant] = useState("");
  const [oidcMode, setOidcMode] = useState<"discovery" | "manual">("discovery");
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providerIdTouched, setProviderIdTouched] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [userInfoEndpoint, setUserInfoEndpoint] = useState("");
  const [jwksEndpoint, setJwksEndpoint] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [cert, setCert] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: org } = await authClient.organization.getFullOrganization({
      query: { organizationSlug: slug },
    });
    if (!org) {
      setLoading(false);
      return;
    }
    setOrganizationId(org.id);
    setOrgName(org.name);

    const [{ data: providerData }, profileData] = await Promise.all([
      authClient.sso.providers(),
      getSsoProviderProfiles(org.id),
    ]);

    setProviders(
      (providerData?.providers ?? []).filter(
        (p) => p.organizationId === org.id,
      ) as SanitizedProvider[],
    );
    setProfiles(profileData);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setStep(0);
    setKind("google");
    setTenant("");
    setOidcMode("discovery");
    setDisplayName("");
    setDomain("");
    setProviderId("");
    setProviderIdTouched(false);
    setIssuer("");
    setClientId("");
    setClientSecret("");
    setAuthorizationEndpoint("");
    setTokenEndpoint("");
    setUserInfoEndpoint("");
    setJwksEndpoint("");
    setEntryPoint("");
    setCert("");
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(provider: SanitizedProvider) {
    const profile = profiles.find((p) => p.providerId === provider.providerId);
    setEditing(provider);
    setStep(0);
    setTenant("");
    setKind(
      (profile?.iconKey as ProviderKind) ??
        (provider.type === "saml" ? "saml" : "oidc"),
    );
    setDisplayName(profile?.displayName ?? provider.providerId);
    setDomain(provider.domain);
    setProviderId(provider.providerId);
    setProviderIdTouched(true);
    setIssuer(provider.issuer);
    setClientId("");
    setClientSecret("");
    setAuthorizationEndpoint(provider.oidcConfig?.authorizationEndpoint ?? "");
    setTokenEndpoint(provider.oidcConfig?.tokenEndpoint ?? "");
    setUserInfoEndpoint(provider.oidcConfig?.userInfoEndpoint ?? "");
    setJwksEndpoint(provider.oidcConfig?.jwksEndpoint ?? "");
    setEntryPoint("");
    setCert("");
    setDialogOpen(true);
  }

  function handleDisplayNameChange(value: string) {
    setDisplayName(value);
    if (!providerIdTouched) {
      setProviderId(
        `${slug}-${slugify(value)}`
          .slice(0, PROVIDER_ID_MAX_LENGTH)
          .replace(/-+$/, ""),
      );
    }
  }

  function handleKindSelect(value: ProviderKind) {
    setKind(value);
    setTenant("");
    const meta = PROVIDER_KINDS.find((k) => k.key === value);
    // Seed the display name with the provider's title (and derive the
    // provider ID from it) unless the user already typed their own.
    if (
      meta &&
      (!displayName || PROVIDER_KINDS.some((k) => k.title === displayName))
    ) {
      handleDisplayNameChange(meta.title);
    }
    setStep(1);
  }

  async function openVerify(target: { providerId: string; domain: string }) {
    setVerifyTarget(target);
    setVerifyToken(null);
    const { data, error } = await authClient.sso.requestDomainVerification({
      providerId: target.providerId,
    });
    if (error) {
      toast.error(error.message ?? "Unable to start domain verification.");
      setVerifyTarget(null);
      return;
    }
    setVerifyToken(data?.domainVerificationToken ?? null);
  }

  async function checkVerification() {
    if (!verifyTarget) return;
    setChecking(true);
    const { error } = await authClient.sso.verifyDomain({
      providerId: verifyTarget.providerId,
    });
    setChecking(false);
    if (error) {
      toast.error(
        error.message ??
          "Domain not verified yet. DNS changes can take a while to propagate.",
      );
      return;
    }
    toast.success("Domain verified. Members can now sign in.");
    setVerifyTarget(null);
    setVerifyToken(null);
    load();
  }

  const selectedKind = PROVIDER_KINDS.find((k) => k.key === kind);
  const isSaml = selectedKind?.type === "saml";
  const baseURL = typeof window !== "undefined" ? window.location.origin : "";
  const callbackUrl = isSaml
    ? `${baseURL}/api/auth/sso/saml2/sp/acs/${providerId || "<provider-id>"}`
    : `${baseURL}/api/auth/sso/callback/${providerId || "<provider-id>"}`;
  const spMetadataUrl = `${baseURL}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(
    providerId,
  )}`;

  // Create walks kind → details → connect; edit keeps the kind and starts at
  // details. `step` indexes into this list.
  const steps = editing
    ? (["details", "connect"] as const)
    : (["kind", "details", "connect"] as const);
  const currentStep = steps[step] ?? steps[0];

  // Known providers derive every endpoint from (at most) one tenant value —
  // only on create; editing always shows the stored endpoints.
  const preset =
    !editing && !isSaml && selectedKind?.endpoints
      ? selectedKind.endpoints(tenant)
      : null;

  // Generic OIDC on create offers the two registration modes from the docs:
  // automatic discovery (endpoints fetched from the issuer) or manual entry.
  const isGenericOidc = !isSaml && !selectedKind?.endpoints;
  const useDiscovery = !editing && isGenericOidc && oidcMode === "discovery";

  const detailsValid =
    displayName.trim() !== "" &&
    domain.trim() !== "" &&
    providerId.trim() !== "";
  const connectValid = editing
    ? true
    : isSaml
      ? issuer.trim() !== "" && entryPoint.trim() !== "" && cert.trim() !== ""
      : preset
        ? (!selectedKind?.tenantInput || tenant.trim() !== "") &&
          clientId.trim() !== "" &&
          clientSecret.trim() !== ""
        : useDiscovery
          ? issuer.trim() !== "" &&
            clientId.trim() !== "" &&
            clientSecret.trim() !== ""
          : issuer.trim() !== "" &&
            clientId.trim() !== "" &&
            clientSecret.trim() !== "" &&
            authorizationEndpoint.trim() !== "" &&
            tokenEndpoint.trim() !== "" &&
            jwksEndpoint.trim() !== "";
  const stepValid =
    currentStep === "kind" ||
    (currentStep === "details" ? detailsValid : connectValid);

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("Unable to copy. Select and copy the value manually.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter (or the Continue button) advances through the wizard; only the
    // final step actually saves.
    if (currentStep !== "connect") {
      if (stepValid) setStep(step + 1);
      return;
    }
    if (!organizationId || !stepValid) return;
    setSaving(true);

    try {
      if (editing) {
        const { error } = await authClient.sso.updateProvider({
          providerId: editing.providerId,
          issuer: issuer || undefined,
          domain: domain || undefined,
          oidcConfig: isSaml
            ? undefined
            : {
                clientId: clientId || undefined,
                clientSecret: clientSecret || undefined,
                authorizationEndpoint: authorizationEndpoint || undefined,
                tokenEndpoint: tokenEndpoint || undefined,
                userInfoEndpoint: userInfoEndpoint || undefined,
                jwksEndpoint: jwksEndpoint || undefined,
              },
          samlConfig: isSaml
            ? {
                entryPoint: entryPoint || undefined,
                cert: cert || undefined,
              }
            : undefined,
        });
        if (error)
          throw new Error(error.message ?? "Unable to update provider.");
        await updateSsoProviderProfile({
          providerId: editing.providerId,
          organizationId,
          displayName,
          iconKey: kind,
        });
        toast.success(`${displayName} updated.`);
      } else {
        // Endpoints come from the kind's preset (known providers), from OIDC
        // Discovery (generic OIDC in automatic mode — resolved server-side
        // with the plugin's own validation), or from the manual fields.
        let resolved: DiscoveredOidcEndpoints | null = preset;
        if (useDiscovery) {
          const discovered = await discoverOidcEndpoints({
            organizationId,
            issuer,
          });
          if ("error" in discovered) throw new Error(discovered.error);
          resolved = discovered;
        }
        const { data, error } = await authClient.sso.register({
          providerId,
          issuer: resolved?.issuer ?? issuer,
          domain,
          organizationId,
          oidcConfig: isSaml
            ? undefined
            : {
                clientId,
                clientSecret,
                // Endpoints are always registered explicitly ("Register an
                // OIDC Provider") so the plugin skips its own runtime fetch
                // of .well-known/openid-configuration.
                skipDiscovery: true,
                authorizationEndpoint:
                  resolved?.authorizationEndpoint ?? authorizationEndpoint,
                tokenEndpoint: resolved?.tokenEndpoint ?? tokenEndpoint,
                userInfoEndpoint:
                  resolved?.userInfoEndpoint ?? (userInfoEndpoint || undefined),
                jwksEndpoint: resolved?.jwksEndpoint ?? jwksEndpoint,
                tokenEndpointAuthentication:
                  resolved?.tokenEndpointAuthentication,
              },
          samlConfig: isSaml
            ? {
                entryPoint,
                cert,
                callbackUrl: `${baseURL}/api/auth/sso/saml2/sp/acs/${providerId}`,
                // Left empty so Better Auth auto-generates SP metadata; the
                // resulting XML is available from auth.api.spMetadata.
                spMetadata: {},
              }
            : undefined,
        });
        if (error)
          throw new Error(error.message ?? "Unable to register provider.");
        await createSsoProviderProfile({
          providerId,
          organizationId,
          displayName,
          iconKey: kind,
        });
        toast.success(`${displayName} added.`);
        // Registration issues the domain-verification token up front — go
        // straight into the verify dialog so the admin can add the DNS
        // record now (sign-in stays blocked until the domain is verified).
        const token = data?.domainVerificationToken;
        if (token) {
          setVerifyTarget({ providerId, domain });
          setVerifyToken(token);
        }
      }
      setDialogOpen(false);
      resetForm();
      load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
    setSaving(false);
  }

  async function remove(id: string) {
    const { error } = await authClient.sso.deleteProvider({ providerId: id });
    if (error) {
      toast.error(error.message ?? "Unable to delete provider.");
      return;
    }
    toast.warning("Provider removed.");
    setDeleteTarget(null);
    load();
  }

  if (loading || !organizationId) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Single sign-on"
        description={`Let members of ${orgName} sign in through your identity provider.`}
      >
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          Add provider
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            {providers.length} provider{providers.length === 1 ? "" : "s"}{" "}
            configured. Members can sign in at{" "}
            <span className="font-mono text-xs">/sign-in/{slug}</span> once the
            provider&apos;s email domain is verified.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-6">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No SSO providers yet. Add one so your members can sign in without
              a password.
            </p>
          ) : (
            providers.map((provider) => {
              const profile = profiles.find(
                (p) => p.providerId === provider.providerId,
              );
              const Icon =
                SSO_PROVIDER_ICONS[
                  (profile?.iconKey as ProviderKind) ?? provider.type
                ] ?? IconKey;
              return (
                <div
                  key={provider.providerId}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                      <Icon className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {profile?.displayName ?? provider.providerId}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {provider.domain}
                        </span>
                        {provider.domainVerified ? (
                          <Badge variant="success">Verified</Badge>
                        ) : (
                          <Badge variant="warning">Unverified</Badge>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="neutral">
                      {provider.type === "saml" ? "SAML" : "OIDC"}
                    </Badge>
                    {!provider.domainVerified ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openVerify({
                            providerId: provider.providerId,
                            domain: provider.domain,
                          })
                        }
                      >
                        Verify domain
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => openEdit(provider)}
                    >
                      <IconPencil className="size-4" />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(provider.providerId)}
                    >
                      <IconTrash className="size-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {currentStep === "kind"
                ? "Add SSO provider"
                : currentStep === "details"
                  ? editing
                    ? "Edit provider"
                    : "Name your provider"
                  : editing
                    ? "Connection settings"
                    : `Connect ${selectedKind?.title}`}
            </DialogTitle>
            <DialogDescription>
              {currentStep === "kind"
                ? "Choose the identity provider your members sign in with."
                : currentStep === "details"
                  ? "How this connection appears to members on the sign-in page."
                  : editing
                    ? "Leave secret fields blank to keep the existing value. Issuer and endpoints lock once members have signed in through this provider."
                    : selectedKind?.connectHelp}
            </DialogDescription>
            <div
              aria-label={`Step ${step + 1} of ${steps.length}`}
              aria-valuemax={steps.length}
              aria-valuemin={1}
              aria-valuenow={step + 1}
              className="flex items-center gap-1.5 pt-1"
              role="progressbar"
            >
              {steps.map((stepKey, index) => (
                <div
                  key={stepKey}
                  className={
                    index <= step
                      ? "h-1 flex-1 rounded-full bg-primary"
                      : "h-1 flex-1 rounded-full bg-muted"
                  }
                />
              ))}
            </div>
          </DialogHeader>
          <form
            id="sso-provider-form"
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            {currentStep === "kind" ? (
              <Choicebox
                value={kind}
                onValueChange={(value) =>
                  handleKindSelect(value as ProviderKind)
                }
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {PROVIDER_KINDS.map((option) => {
                  const KindIcon = SSO_PROVIDER_ICONS[option.key];
                  return (
                    <ChoiceboxItem
                      key={option.key}
                      value={option.key}
                      id={`sso-kind-${option.key}`}
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                        <KindIcon className="size-4" />
                      </div>
                      <ChoiceboxItemHeader>
                        <ChoiceboxItemTitle>{option.title}</ChoiceboxItemTitle>
                        <ChoiceboxItemDescription>
                          {option.description}
                        </ChoiceboxItemDescription>
                      </ChoiceboxItemHeader>
                      <ChoiceboxIndicator />
                    </ChoiceboxItem>
                  );
                })}
              </Choicebox>
            ) : null}

            {currentStep === "details" ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="sso-display-name">
                    Display name
                  </FieldLabel>
                  <Input
                    id="sso-display-name"
                    required
                    autoFocus
                    value={displayName}
                    onChange={(event) =>
                      handleDisplayNameChange(event.target.value)
                    }
                    placeholder="Acme Google Workspace"
                  />
                  <p className="text-xs text-muted-foreground">
                    Members see it on the sign-in page as &ldquo;Continue with{" "}
                    {displayName || "…"}&rdquo;.
                  </p>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sso-domain">Email domain</FieldLabel>
                  <Input
                    id="sso-domain"
                    required
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="acme.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Members with an email on this domain can use this provider.
                    Separate multiple domains with commas.
                    {editing
                      ? " Changing it resets domain verification."
                      : " You'll verify ownership with a DNS record after saving."}
                  </p>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sso-provider-id">Provider ID</FieldLabel>
                  <Input
                    id="sso-provider-id"
                    required
                    disabled={!!editing}
                    value={providerId}
                    maxLength={PROVIDER_ID_MAX_LENGTH}
                    className="font-mono text-xs"
                    onChange={(event) => {
                      setProviderIdTouched(true);
                      setProviderId(event.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Becomes part of the callback URL your IdP redirects to.
                    {editing ? "" : " Locked after creation."}
                  </p>
                </Field>
              </FieldGroup>
            ) : null}

            {currentStep === "connect" ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="sso-callback-url">
                    {isSaml ? "ACS (callback) URL" : "Callback URL"}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="sso-callback-url"
                      readOnly
                      value={callbackUrl}
                      className="font-mono text-xs"
                      onFocus={(event) => event.target.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        copyText(callbackUrl, "Callback URL copied.")
                      }
                    >
                      <IconCopy className="size-4" />
                      <span className="sr-only">Copy callback URL</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add this {isSaml ? "ACS URL" : "redirect URI"} to your
                    identity provider first — it issues the credentials below.
                  </p>
                </Field>

                {isSaml ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="sso-sp-metadata">
                        SP metadata URL
                      </FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          id="sso-sp-metadata"
                          readOnly
                          value={spMetadataUrl}
                          className="font-mono text-xs"
                          onFocus={(event) => event.target.select()}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            copyText(spMetadataUrl, "SP metadata URL copied.")
                          }
                        >
                          <IconCopy className="size-4" />
                          <span className="sr-only">Copy SP metadata URL</span>
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        If your IdP can import SP metadata, point it here
                        instead of copying fields by hand.
                      </p>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sso-issuer">
                        IdP issuer (entity ID)
                      </FieldLabel>
                      <Input
                        id="sso-issuer"
                        type="url"
                        required={!editing}
                        autoFocus
                        value={issuer}
                        onChange={(event) => setIssuer(event.target.value)}
                        placeholder="https://idp.example.com"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sso-entry-point">
                        Sign-on URL (entry point)
                      </FieldLabel>
                      <Input
                        id="sso-entry-point"
                        type="url"
                        required={!editing}
                        value={entryPoint}
                        onChange={(event) => setEntryPoint(event.target.value)}
                        placeholder="https://idp.example.com/sso"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sso-cert">
                        IdP signing certificate (PEM)
                      </FieldLabel>
                      <Textarea
                        id="sso-cert"
                        required={!editing}
                        value={cert}
                        onChange={(event) => setCert(event.target.value)}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        className="min-h-32 font-mono text-xs"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    {!editing && selectedKind?.tenantInput ? (
                      <Field>
                        <FieldLabel htmlFor="sso-tenant">
                          {selectedKind.tenantInput.label}
                        </FieldLabel>
                        <Input
                          id="sso-tenant"
                          required
                          autoFocus
                          value={tenant}
                          onChange={(event) => setTenant(event.target.value)}
                          placeholder={selectedKind.tenantInput.placeholder}
                        />
                        {preset && tenant.trim() ? (
                          <p className="text-xs text-muted-foreground">
                            Issuer:{" "}
                            <span className="font-mono">{preset.issuer}</span>
                          </p>
                        ) : null}
                      </Field>
                    ) : null}
                    {!editing && isGenericOidc ? (
                      <Choicebox
                        value={oidcMode}
                        onValueChange={(value) =>
                          setOidcMode(value as "discovery" | "manual")
                        }
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                      >
                        <ChoiceboxItem
                          value="discovery"
                          id="sso-oidc-mode-discovery"
                        >
                          <ChoiceboxItemHeader>
                            <ChoiceboxItemTitle>
                              Automatic discovery
                            </ChoiceboxItemTitle>
                            <ChoiceboxItemDescription>
                              Fetch endpoints from the issuer&apos;s discovery
                              document
                            </ChoiceboxItemDescription>
                          </ChoiceboxItemHeader>
                          <ChoiceboxIndicator />
                        </ChoiceboxItem>
                        <ChoiceboxItem value="manual" id="sso-oidc-mode-manual">
                          <ChoiceboxItemHeader>
                            <ChoiceboxItemTitle>
                              Manual endpoints
                            </ChoiceboxItemTitle>
                            <ChoiceboxItemDescription>
                              Enter each OIDC endpoint yourself
                            </ChoiceboxItemDescription>
                          </ChoiceboxItemHeader>
                          <ChoiceboxIndicator />
                        </ChoiceboxItem>
                      </Choicebox>
                    ) : null}
                    {!preset ? (
                      <Field>
                        <FieldLabel htmlFor="sso-issuer">Issuer URL</FieldLabel>
                        <Input
                          id="sso-issuer"
                          type="url"
                          required={!editing}
                          autoFocus={!editing}
                          value={issuer}
                          onChange={(event) => setIssuer(event.target.value)}
                          placeholder="https://idp.example.com"
                        />
                        {useDiscovery ? (
                          <p className="text-xs text-muted-foreground">
                            Endpoints are fetched and validated from{" "}
                            <span className="font-mono">
                              {`${(issuer.trim() || "https://idp.example.com").replace(/\/+$/, "")}/.well-known/openid-configuration`}
                            </span>{" "}
                            when you save.
                          </p>
                        ) : null}
                      </Field>
                    ) : null}
                    <Field>
                      <FieldLabel htmlFor="sso-client-id">Client ID</FieldLabel>
                      <Input
                        id="sso-client-id"
                        required={!editing}
                        autoFocus={!!preset && !selectedKind?.tenantInput}
                        value={clientId}
                        onChange={(event) => setClientId(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sso-client-secret">
                        Client secret
                      </FieldLabel>
                      <Input
                        id="sso-client-secret"
                        type="password"
                        required={!editing}
                        value={clientSecret}
                        onChange={(event) =>
                          setClientSecret(event.target.value)
                        }
                      />
                      {preset && !selectedKind?.tenantInput ? (
                        <p className="text-xs text-muted-foreground">
                          Endpoints are preconfigured for {selectedKind?.title}.
                        </p>
                      ) : null}
                    </Field>
                    {!preset && !useDiscovery ? (
                      <>
                        <Field>
                          <FieldLabel htmlFor="sso-authorization-endpoint">
                            Authorization endpoint
                          </FieldLabel>
                          <Input
                            id="sso-authorization-endpoint"
                            type="url"
                            required={!editing}
                            value={authorizationEndpoint}
                            onChange={(event) =>
                              setAuthorizationEndpoint(event.target.value)
                            }
                            placeholder="https://idp.example.com/authorize"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="sso-token-endpoint">
                            Token endpoint
                          </FieldLabel>
                          <Input
                            id="sso-token-endpoint"
                            type="url"
                            required={!editing}
                            value={tokenEndpoint}
                            onChange={(event) =>
                              setTokenEndpoint(event.target.value)
                            }
                            placeholder="https://idp.example.com/token"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="sso-userinfo-endpoint">
                            UserInfo endpoint{" "}
                            <span className="font-normal text-muted-foreground">
                              (optional)
                            </span>
                          </FieldLabel>
                          <Input
                            id="sso-userinfo-endpoint"
                            type="url"
                            value={userInfoEndpoint}
                            onChange={(event) =>
                              setUserInfoEndpoint(event.target.value)
                            }
                            placeholder="https://idp.example.com/userinfo"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="sso-jwks-endpoint">
                            JWKS endpoint
                          </FieldLabel>
                          <Input
                            id="sso-jwks-endpoint"
                            type="url"
                            required={!editing}
                            value={jwksEndpoint}
                            onChange={(event) =>
                              setJwksEndpoint(event.target.value)
                            }
                            placeholder="https://idp.example.com/jwks"
                          />
                        </Field>
                      </>
                    ) : null}
                  </>
                )}
              </FieldGroup>
            ) : null}
          </form>
          <DialogFooter>
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="submit"
              form="sso-provider-form"
              disabled={saving || !stepValid}
            >
              {saving ? <Spinner /> : null}
              {currentStep === "connect"
                ? editing
                  ? "Save changes"
                  : "Add provider"
                : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVerifyTarget(null);
            setVerifyToken(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify domain ownership</DialogTitle>
            <DialogDescription>
              Add this TXT record to the DNS settings of{" "}
              <span className="font-medium">{verifyTarget?.domain}</span> to
              prove your organization owns it. Sign-in through this provider
              stays disabled until the domain is verified.
            </DialogDescription>
          </DialogHeader>
          {verifyToken === null ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sso-verify-host">
                  TXT record host
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="sso-verify-host"
                    readOnly
                    value={`_better-auth-token-${verifyTarget?.providerId}`}
                    className="font-mono text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      copyText(
                        `_better-auth-token-${verifyTarget?.providerId}`,
                        "Record host copied.",
                      )
                    }
                  >
                    <IconCopy className="size-4" />
                    <span className="sr-only">Copy record host</span>
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="sso-verify-value">
                  TXT record value
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="sso-verify-value"
                    readOnly
                    value={verifyToken}
                    className="font-mono text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      copyText(verifyToken, "Record value copied.")
                    }
                  >
                    <IconCopy className="size-4" />
                    <span className="sr-only">Copy record value</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  If the provider lists multiple comma-separated domains, add
                  the record under every one. DNS changes can take up to 48
                  hours to propagate, but it&apos;s usually much faster. You can
                  close this dialog and come back later — the token stays valid
                  for 7 days.
                </p>
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button
              type="button"
              onClick={checkVerification}
              disabled={checking || verifyToken === null}
            >
              {checking ? <Spinner /> : null}
              Check DNS record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this provider?"
        description="Members will no longer be able to sign in through it. This cannot be undone."
        confirmLabel="Remove"
        pendingLabel="Removing..."
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
      />
    </PageContainer>
  );
}
