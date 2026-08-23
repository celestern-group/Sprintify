import {
  IconBrandAuth0,
  IconBrandAzure,
  IconBrandGoogle,
  IconCertificate,
  IconKey,
  IconServer,
} from "@tabler/icons-react";

export type ProviderKind =
  | "google"
  | "azure"
  | "auth0"
  | "okta"
  | "zitadel"
  | "oidc"
  | "saml";

export type OidcEndpointPreset = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  userInfoEndpoint?: string;
};

/** Lets users paste "https://acme.okta.com/" where a bare host is expected. */
function bareHost(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export type ProviderKindMeta = {
  key: ProviderKind;
  title: string;
  description: string;
  type: "oidc" | "saml";
  /** Where in the IdP to create the app — shown on the connect step. */
  connectHelp: string;
  /**
   * Single extra value (tenant/instance) the preset needs to derive every
   * endpoint. Kinds with `endpoints` but no `tenantInput` (Google) are fully
   * fixed; kinds with neither fall back to manual endpoint entry.
   */
  tenantInput?: { label: string; placeholder: string };
  endpoints?: (tenant: string) => OidcEndpointPreset;
};

export const PROVIDER_KINDS: ProviderKindMeta[] = [
  {
    key: "google",
    title: "Google Workspace",
    description: "Workspace accounts via OIDC",
    type: "oidc",
    connectHelp:
      "In Google Cloud Console → APIs & Services → Credentials, create an OAuth client (Web application) and add the callback URL below as an authorized redirect URI.",
    endpoints: () => ({
      issuer: "https://accounts.google.com",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksEndpoint: "https://www.googleapis.com/oauth2/v3/certs",
      userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    }),
  },
  {
    key: "azure",
    title: "Microsoft Entra ID",
    description: "Azure AD work accounts",
    type: "oidc",
    connectHelp:
      "In Microsoft Entra admin center → App registrations, register an app, add the callback URL below as a Web redirect URI, then create a client secret.",
    tenantInput: {
      label: "Directory (tenant) ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
    },
    endpoints: (tenant) => {
      const t = encodeURIComponent(tenant.trim());
      return {
        issuer: `https://login.microsoftonline.com/${t}/v2.0`,
        authorizationEndpoint: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
        tokenEndpoint: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
        jwksEndpoint: `https://login.microsoftonline.com/${t}/discovery/v2.0/keys`,
        userInfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
      };
    },
  },
  {
    key: "okta",
    title: "Okta",
    description: "Okta org via OIDC",
    type: "oidc",
    connectHelp:
      "In Okta Admin → Applications, create an OIDC Web App and add the callback URL below as a sign-in redirect URI.",
    tenantInput: { label: "Okta domain", placeholder: "acme.okta.com" },
    endpoints: (tenant) => {
      const host = bareHost(tenant);
      return {
        issuer: `https://${host}`,
        authorizationEndpoint: `https://${host}/oauth2/v1/authorize`,
        tokenEndpoint: `https://${host}/oauth2/v1/token`,
        jwksEndpoint: `https://${host}/oauth2/v1/keys`,
        userInfoEndpoint: `https://${host}/oauth2/v1/userinfo`,
      };
    },
  },
  {
    key: "auth0",
    title: "Auth0",
    description: "Auth0 tenant via OIDC",
    type: "oidc",
    connectHelp:
      "In Auth0 Dashboard → Applications, create a Regular Web Application and add the callback URL below to Allowed Callback URLs.",
    tenantInput: { label: "Auth0 domain", placeholder: "acme.us.auth0.com" },
    endpoints: (tenant) => {
      const host = bareHost(tenant);
      return {
        // Auth0 issues tokens with a trailing slash on `iss`.
        issuer: `https://${host}/`,
        authorizationEndpoint: `https://${host}/authorize`,
        tokenEndpoint: `https://${host}/oauth/token`,
        jwksEndpoint: `https://${host}/.well-known/jwks.json`,
        userInfoEndpoint: `https://${host}/userinfo`,
      };
    },
  },
  {
    key: "zitadel",
    title: "Zitadel",
    description: "Zitadel instance via OIDC",
    type: "oidc",
    connectHelp:
      "In your Zitadel console, create a Web application in a project and add the callback URL below as a redirect URI.",
    tenantInput: {
      label: "Zitadel domain",
      placeholder: "acme-abc123.zitadel.cloud",
    },
    endpoints: (tenant) => {
      const host = bareHost(tenant);
      return {
        issuer: `https://${host}`,
        authorizationEndpoint: `https://${host}/oauth/v2/authorize`,
        tokenEndpoint: `https://${host}/oauth/v2/token`,
        jwksEndpoint: `https://${host}/oauth/v2/keys`,
        userInfoEndpoint: `https://${host}/oidc/v1/userinfo`,
      };
    },
  },
  {
    key: "oidc",
    title: "Generic OIDC",
    description: "Any OpenID Connect IdP",
    type: "oidc",
    connectHelp:
      "Create an OAuth/OIDC client in your identity provider and add the callback URL below as a redirect URI. Endpoints can be discovered automatically from the issuer or entered manually.",
  },
  {
    key: "saml",
    title: "SAML 2.0",
    description: "Any SAML IdP",
    type: "saml",
    connectHelp:
      "Create a SAML app in your identity provider using the ACS URL and SP metadata below, then paste its sign-on URL and signing certificate here.",
  },
];

export const SSO_PROVIDER_ICONS: Record<ProviderKind, typeof IconKey> = {
  google: IconBrandGoogle,
  azure: IconBrandAzure,
  auth0: IconBrandAuth0,
  okta: IconServer,
  zitadel: IconServer,
  oidc: IconKey,
  saml: IconCertificate,
};
