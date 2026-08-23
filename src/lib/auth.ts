import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { admin, captcha, organization, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ApproveEmailChangeEmail } from "@/emails/approve-email-change";
import { DeleteAccountEmail } from "@/emails/delete-account";
import { OrganizationInvitationEmail } from "@/emails/organization-invitation";
import { ResetPasswordEmail } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { env } from "@/env";
import { recordAudit } from "@/lib/audit";
import { seedOrganizationDefaultCalendar } from "@/lib/calendar-seed";
import { sendMail } from "@/lib/mailer";
import { MCP_READ_PERMISSION } from "@/lib/mcp/permissions";
import {
  countOrganizationProjects,
  organizationHasProjectsMessage,
} from "@/lib/organization-projects";
import { ac, orgAc, orgRoles, roles } from "@/lib/permissions";
import {
  getPlatformLockdown,
  getSignupDisabled,
} from "@/lib/platform-lockdown";
import { seedOrganizationProjectRoles } from "@/lib/project-role-seed";
import { hasAdminRole } from "@/lib/roles";
import { isPublicHttpUrlWithDns } from "@/lib/url-guard-dns";
import { seedOrganizationWorkItemTypes } from "@/lib/work-item-seed";

function sendMailSafe(...args: Parameters<typeof sendMail>) {
  void sendMail(...args).catch((error) => {
    console.error("Failed to send email:", error);
  });
}

// Only used when public sign-up is disabled (the runtime "invite only" switch,
// platformSettings.signupDisabled): org invites to a not-yet-registered email
// provision the account server-side
// instead of relying on self-serve /sign-up. `auth.api.createUser` is called
// with no headers/request, which is Better Auth's documented "server" calling
// convention — it skips the admin-role permission gate entirely since that
// gate only triggers when a real incoming request/headers is present.
// Omitting `password` leaves the user with no linked credential account,
// which doubles as the "hasn't set a password yet" signal on re-invite.
async function ensureInviteeAccount(email: string): Promise<boolean> {
  try {
    await auth.api.createUser({
      body: { email, name: email, data: { emailVerified: true } },
    });
    return true;
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    if (code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") throw error;
    // Already exists — fall through to check whether they've activated.
  }
  const existingUser = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });
  if (!existingUser) return false;
  return !(await hasCredentialAccount(existingUser.id));
}

// Whether the user has a password at all. Better Auth only writes a
// `credential` account row once one is set, so its absence is the durable
// "provisioned but never activated" signal — used both to decide whether an
// invite needs an activation link and to pick the wording of that mail.
async function hasCredentialAccount(userId: string): Promise<boolean> {
  const credential = await db.query.account.findFirst({
    where: (a, { eq, and }) =>
      and(eq(a.userId, userId), eq(a.providerId, "credential")),
  });
  return Boolean(credential);
}

// Cloudflare's public "always-passes" test secret. Fine for local dev, but a
// hard fail-open if it ever reaches production (captcha would be a no-op on
// sign-in/sign-up/password-reset), so it's only permitted outside production.
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

function turnstileSecretKey() {
  const key = env.TURNSTILE_SECRET_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing TURNSTILE_SECRET_KEY. Set it in production so captcha verification is enforced.",
    );
  }
  return TURNSTILE_TEST_SECRET_KEY;
}

// Orgs bring arbitrary, self-hosted IdPs (Okta tenants, Zitadel instances,
// Google Workspace, ...), so a static trusted-origins list can't cover them.
// SSO provider registration/updates are already gated to org owners/admins
// (enforced by the sso plugin itself), so it's safe to dynamically trust the
// issuer origin being submitted through those two endpoints — this mirrors
// the "dynamically compute trustedOrigins" pattern from Better Auth's own
// SSO docs for supporting multiple arbitrary IdPs.
//
// This function is the ONLY server-side gate on those endpoints: the panel
// calls `authClient.sso.register` straight from the browser, so the manual
// token/JWKS/user-info URLs never pass through a server action. Whatever it
// returns, the plugin will later fetch server-side during the sign-in callback.
// Every URL therefore goes through the DNS-resolving SSRF guard here — a URL
// the guard rejects is simply not added, the plugin's own trusted-origin check
// then fails it, and registration is refused.
async function ssoTrustedOrigins(request: Request | undefined) {
  if (!request) return [];

  const { pathname } = new URL(request.url);
  if (
    !pathname.endsWith("/sso/register") &&
    !pathname.endsWith("/sso/update-provider")
  ) {
    return [];
  }

  try {
    const body = await request.clone().json();
    const issuer = typeof body?.issuer === "string" ? body.issuer : null;
    if (!issuer) return [];
    if (!(await isPublicHttpUrlWithDns(issuer))) return [];

    const origins = new Set([new URL(issuer).origin]);

    // OIDC providers are registered with explicit endpoints ("Register an
    // OIDC Provider", oidcConfig.skipDiscovery: true) rather than OIDC
    // Discovery, so there's no discovery document to fetch. Those endpoints
    // often live on a different origin than the issuer (e.g. Google: issuer
    // is accounts.google.com, but its token endpoint is
    // oauth2.googleapis.com) — trust each one directly from the submitted
    // body so the plugin's own trustedOrigins-gated validation passes.
    const oidcConfig = body?.oidcConfig;
    if (oidcConfig && typeof oidcConfig === "object") {
      for (const key of [
        "authorizationEndpoint",
        "tokenEndpoint",
        "userInfoEndpoint",
        "jwksEndpoint",
        "discoveryEndpoint",
      ]) {
        const url = oidcConfig[key];
        if (typeof url !== "string") continue;
        // Unsafe or unparseable: leave it untrusted so the plugin rejects it.
        if (!(await isPublicHttpUrlWithDns(url))) continue;
        origins.add(new URL(url).origin);
      }
    }
    return [...origins];
  } catch {
    return [];
  }
}

// Mirrors the SSO plugin's own `validateEmailDomain` / `domainMatches`:
// `provider.domain` may be a comma-separated list, and a domain matches either
// exactly or as a subdomain suffix. Kept in sync with the plugin so the check
// below grants exactly the trust the plugin's own `isTrustedProvider` does.
function emailMatchesProviderDomain(email: string, domain: string | undefined) {
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain || !domain) return false;
  return domain
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((d) => emailDomain === d || emailDomain.endsWith(`.${d}`));
}

// Every write the Better Auth admin plugin performs on a user — create, role
// change, ban, password reset, deletion, session revocation, impersonation — is
// a platform-privileged mutation, but it runs inside Better Auth's own
// endpoints, so there is no server action to hang `recordAudit` off the way
// src/lib/actions/* does. An `after` hook is the only choke point that covers
// them all. Read-only endpoints (`list-users`, `get-user`, `has-permission`)
// are deliberately absent — the audit log records state changes.
const ADMIN_AUDIT_ACTIONS: Record<string, string> = {
  "/admin/create-user": "user.created",
  "/admin/update-user": "user.updated",
  "/admin/set-role": "user.role_updated",
  "/admin/ban-user": "user.banned",
  "/admin/unban-user": "user.unbanned",
  "/admin/set-user-password": "user.password_set",
  "/admin/remove-user": "user.deleted",
  "/admin/revoke-user-session": "user.session_revoked",
  "/admin/revoke-user-sessions": "user.sessions_revoked",
  "/admin/impersonate-user": "user.impersonated",
  "/admin/stop-impersonating": "user.impersonation_stopped",
  // API-key writes happen inside Better Auth endpoints too. Keep these in the
  // same middleware audit choke point as the admin plugin, rather than making
  // the Profile UI responsible for recording a security-sensitive mutation.
  "/api-key/create": "api_key.created",
  "/api-key/update": "api_key.updated",
  "/api-key/delete": "api_key.deleted",
};

// Non-secret request-body fields only. `newPassword` (set-user-password) and
// `sessionToken` (revoke-user-session) are credentials and must never reach the
// audit log, so anything not listed here falls through to no metadata.
function adminAuditMetadata(path: string, body: Record<string, unknown>) {
  switch (path) {
    case "/admin/create-user":
      return { email: body.email ?? null, role: body.role ?? null };
    case "/admin/update-user":
      return { fields: Object.keys((body.data as object | null) ?? {}) };
    case "/admin/set-role":
      return { role: body.role ?? null };
    case "/api-key/create":
      return { name: body.name ?? null };
    case "/api-key/update":
      return { name: body.name ?? null };
    case "/admin/ban-user":
      return {
        banReason: body.banReason ?? null,
        banExpiresIn: body.banExpiresIn ?? null,
      };
    default:
      return null;
  }
}

export const auth = betterAuth({
  appName: "Sprintify",
  trustedOrigins: ssoTrustedOrigins,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  databaseHooks: {
    // Platform lockdown ("red button", /admin/platform): a user.create.before
    // database hook is the single choke point for EVERY way a user row can be
    // born — email sign-up, SSO implicit provisioning, invite provisioning
    // (ensureInviteeAccount), and admin createUser. All are blocked while the
    // lockdown is active; lift it from /admin/platform first if an admin
    // genuinely needs to create a user mid-incident.
    user: {
      create: {
        before: async () => {
          const lockdown = await getPlatformLockdown();
          if (lockdown.enabled) {
            throw new APIError("FORBIDDEN", { message: lockdown.message });
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordAudit({
            action: "auth.sign_in",
            organizationId:
              (session.activeOrganizationId as string | null | undefined) ??
              null,
            actor: { id: session.userId },
            targetType: "session",
            targetId: session.id,
          });
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Runtime "invite only" switch (platformSettings.signupDisabled, toggled
      // at /admin/platform). Better Auth's emailAndPassword.disableSignUp is
      // resolved once at init, so it can't back a runtime toggle — gate the
      // self-serve sign-up endpoint here instead. This only blocks public
      // /sign-up/email; SSO, invite provisioning, and admin createUser keep
      // working.
      if (ctx.path === "/sign-up/email") {
        if (await getSignupDisabled()) {
          throw new APIError("FORBIDDEN", {
            message: "Sign-up is by invitation only.",
          });
        }
        return;
      }

      // The single-session revoke endpoint identifies its target by session
      // token alone, and the row is deleted by the time the after hook runs —
      // resolve the owning user here so the audit entry can name whose session
      // was killed. Stashed on the context (Better Auth merges a returned
      // `context` into the one the after hook receives); the token itself is a
      // credential and is never recorded.
      if (ctx.path === "/admin/revoke-user-session") {
        const token = (ctx.body as { sessionToken?: string } | undefined)
          ?.sessionToken;
        if (!token) return;
        const row = await db.query.session.findFirst({
          where: (s, { eq }) => eq(s.token, token),
          columns: { userId: true },
        });
        return { context: { auditTargetUserId: row?.userId ?? null } };
      }
    }),
    // See ADMIN_AUDIT_ACTIONS above. Must not return a value: an after hook's
    // return value replaces the endpoint's response.
    after: createAuthMiddleware(async (ctx) => {
      const action = ADMIN_AUDIT_ACTIONS[ctx.path];
      if (!action) return;
      // After hooks also run for failed endpoints, where `returned` carries the
      // APIError — only successful mutations get an audit entry.
      if (isAPIError(ctx.context.returned)) return;

      // `disableRefresh` keeps this read from appending a session cookie to a
      // response that (for impersonation) has already set its own.
      const session = await getSessionFromCtx(ctx, { disableRefresh: true });
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const returned = ctx.context.returned as
        | { user?: { id?: string }; id?: string }
        | undefined;

      // Stopping impersonation runs on the *impersonated* session, so the
      // acting admin is the one it points back to, not its user.
      const stoppingImpersonation = ctx.path === "/admin/stop-impersonating";
      const actor = stoppingImpersonation
        ? { id: session?.session.impersonatedBy ?? null }
        : { id: session?.user.id, email: session?.user.email };

      const targetId =
        ctx.path === "/admin/create-user"
          ? (returned?.user?.id ?? null)
          : ctx.path === "/api-key/create"
            ? (returned?.id ?? null)
            : ctx.path === "/api-key/update" || ctx.path === "/api-key/delete"
              ? ((body.keyId as string | undefined) ?? null)
              : stoppingImpersonation
                ? (session?.user.id ?? null)
                : ctx.path === "/admin/revoke-user-session"
                  ? ((ctx as { auditTargetUserId?: string | null })
                      .auditTargetUserId ?? null)
                  : ((body.userId as string | undefined) ?? null);

      await recordAudit({
        action,
        actor,
        targetType: ctx.path.startsWith("/api-key/") ? "api_key" : "user",
        targetId,
        metadata: adminAuditMetadata(ctx.path, body),
      });
    }),
  },
  // Persist rate-limit counters in Postgres (the default in-memory store resets
  // on restart and can't be shared across instances). Only enforced in
  // production; sensitive auth endpoints get stricter per-path windows.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 10, max: 3 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 3 },
      "/two-factor/*": { window: 10, max: 3 },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const callbackURL = new URL(url).searchParams.get("callbackURL") ?? "";
      // Two flows send a reset link to someone who has never had a password:
      // invite provisioning (ensureInviteeAccount, link points at the pending
      // invitation) and a direct org-admin add (src/lib/actions/org-members.ts,
      // which has no invitation to point at and marks the link `activate=1`).
      // Both get the "set your password" copy rather than "reset".
      //
      // The third case carries no marker at all: an admin-provisioned user
      // whose activation link expired (the token lives 1 hour) and who then
      // uses "Forgot password" to get themselves in. That request comes from
      // /forget-password with no hint of its origin, so fall back to asking
      // whether they have any credential to reset — a user with no `credential`
      // account has never had a password, and "reset your password" would be
      // nonsense addressed to them.
      const isInvite =
        callbackURL.includes("/accept-invitation/") ||
        callbackURL.includes("activate=1") ||
        !(await hasCredentialAccount(user.id));
      sendMailSafe({
        to: user.email,
        subject: isInvite
          ? "Set your password to join your team"
          : "Reset your password",
        react: ResetPasswordEmail({
          userName: user.name,
          resetUrl: url,
          isInvite,
        }),
      });
    },
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      sendMailSafe({
        to: user.email,
        subject: "Verify your email address",
        react: VerifyEmail({ userName: user.name, verifyUrl: url }),
      });
    },
  },
  session: {
    additionalFields: {
      // Written server-side only (setActiveProject), never accepted from a
      // client payload — it is authorization-adjacent state, so `input: false`.
      activeProjectId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        sendMailSafe({
          to: user.email,
          subject: "Approve email address change",
          react: ApproveEmailChangeEmail({
            userName: user.name,
            newEmail,
            approveUrl: url,
          }),
        });
      },
    },
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        sendMailSafe({
          to: user.email,
          subject: "Confirm account deletion",
          react: DeleteAccountEmail({ userName: user.name, deleteUrl: url }),
        });
      },
    },
  },
  plugins: [
    admin({
      ac,
      roles,
      adminRoles: ["admin", "superadmin"],
    }),
    organization({
      ac: orgAc,
      roles: orgRoles,
      creatorRole: "owner",
      schema: {
        organization: {
          additionalFields: {
            // Platform-admin grant for the shared AI configuration.
            // `input: false` is the load-bearing part: it keeps the org-update
            // API from accepting this from a client, so only
            // setOrganizationAiAccess (src/lib/actions/admin-ai.ts) can set it.
            aiPlatformAccess: {
              type: "boolean",
              required: false,
              input: false,
            },
          },
        },
      },
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          const lockdown = await getPlatformLockdown();
          if (lockdown.enabled) {
            throw new APIError("FORBIDDEN", { message: lockdown.message });
          }
          return { data: organization };
        },
        // Give the new org its starting project-role catalog. Deliberately
        // swallows failures: this hook returns void, so throwing would fail the
        // whole org creation over seeding. Read paths call
        // ensureOrganizationProjectRoles as a backstop.
        afterCreateOrganization: async ({ organization, user }) => {
          try {
            await seedOrganizationProjectRoles(organization.id);
          } catch (error) {
            console.error("Failed to seed project roles:", error);
          }
          try {
            await seedOrganizationDefaultCalendar(organization.id);
          } catch (error) {
            console.error("Failed to seed default holiday calendar:", error);
          }
          try {
            await seedOrganizationWorkItemTypes(organization.id);
          } catch (error) {
            console.error("Failed to seed work item types:", error);
          }
          await recordAudit({
            action: "organization.created",
            organizationId: organization.id,
            actor: { id: user.id, email: user.email },
            targetType: "organization",
            targetId: organization.id,
            metadata: { name: organization.name, slug: organization.slug },
          });
        },
        // An org owner/admin must empty the org before deleting it: the
        // organization FK cascades, so one confirm would silently take every
        // project (plus its roles, members and embeddings) with it. Forcing
        // the projects to be deleted first keeps that destruction explicit.
        // Platform admins are exempt — /admin/organizations is the deliberate
        // "delete everything at once" tool. Its server action
        // (deleteOrganization, src/lib/actions/admin-organizations.ts) deletes
        // the row directly and never reaches this hook, so this branch only
        // covers a platform admin deleting from the org-facing settings page.
        beforeDeleteOrganization: async ({ organization: org, user }) => {
          if (hasAdminRole((user as { role?: string | null }).role)) return;
          const projectCount = await countOrganizationProjects(org.id);
          if (projectCount > 0) {
            throw new APIError("BAD_REQUEST", {
              message: organizationHasProjectsMessage(org.name, projectCount),
            });
          }
        },
        // Platform lockdown also freezes invitations — otherwise an invite
        // would be created, then fail user provisioning at accept time with a
        // confusing error. Fail fast at the send instead.
        beforeCreateInvitation: async () => {
          const lockdown = await getPlatformLockdown();
          if (lockdown.enabled) {
            throw new APIError("FORBIDDEN", { message: lockdown.message });
          }
        },
      },
      sendInvitationEmail: async (data) => {
        if (await getSignupDisabled()) {
          const needsActivation = await ensureInviteeAccount(data.email);
          if (needsActivation) {
            await auth.api.requestPasswordReset({
              body: {
                email: data.email,
                redirectTo: `/reset-password?next=${encodeURIComponent(
                  `/accept-invitation/${data.id}`,
                )}`,
              },
            });
            return;
          }
        }
        const inviteUrl = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
        sendMailSafe({
          to: data.email,
          subject: `You've been invited to join ${data.organization.name}`,
          react: OrganizationInvitationEmail({
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            roleLabel: data.role,
            inviteUrl,
          }),
        });
        await recordAudit({
          action: "invitation.sent",
          organizationId: data.organization.id,
          actor: {
            id: data.inviter.user.id,
            email: data.inviter.user.email,
          },
          targetType: "invitation",
          targetId: data.id,
          metadata: { email: data.email, role: data.role },
        });
      },
    }),
    sso({
      organizationProvisioning: {
        disabled: false,
        defaultRole: "member",
      },
      // First-time SSO sign-ins auto-provision the user and add them to the
      // linked organization — the "click a provider, no input" flow depends
      // on this being allowed.
      disableImplicitSignUp: false,
      // Providers are untrusted until the org proves domain ownership via a
      // DNS TXT record (sign-ins are blocked until then). Verification is
      // what makes a provider "trusted", which in turn allows SSO logins to
      // auto-link to existing same-email accounts (e.g. users provisioned by
      // the invite flow) — without it, SAML sign-ins for existing users fail
      // with "account not linked". It also blocks a hostile org admin from
      // pointing their own IdP at someone else's email domain.
      domainVerification: {
        enabled: true,
      },
      // SSO-provisioned users would otherwise land with `emailVerified: false`
      // forever: the plugin hard-codes that flag off unless `trustEmailVerified`
      // is set, and that option is deprecated (and explicitly unsafe here, since
      // org admins can freely register providers). Domain verification is the
      // trust mechanism it points to instead — so re-assert exactly the
      // condition the plugin's own `isTrustedProvider` uses (DNS-proven domain
      // AND the asserted email inside that domain) and mark the address verified
      // only then. Note `trustEmailVerified` is NOT simply gated on the domain
      // upstream, which is why this can't be expressed by the option alone.
      //
      // Runs on register only (`provisionUserOnEveryLogin` defaults to false),
      // after the user row exists but before the session cookie is set.
      provisionUser: async ({ user, provider }) => {
        if (user.emailVerified) return;
        const domainVerified =
          "domainVerified" in provider && provider.domainVerified === true;
        if (!domainVerified) return;
        if (!emailMatchesProviderDomain(user.email, provider.domain)) return;

        await db
          .update(schema.user)
          .set({ emailVerified: true })
          .where(eq(schema.user.id, user.id));
      },
      saml: {
        requireTimestamps: true,
        algorithms: { onDeprecated: "reject" },
        // SP-initiated only: every SAML response must answer an AuthnRequest
        // we issued (InResponseTo validation is on by default). IdP-dashboard
        // launches would also need a dedicated GET route handler under
        // /api/auth/sso/saml2/callback/[providerId] — enable both together
        // if that flow is ever needed.
        allowIdpInitiated: false,
      },
    }),
    // TOTP (authenticator app) + backup codes. Account lockout after repeated
    // failed verifications is on by default. No email-OTP factor by design.
    twoFactor(),
    apiKey({
      // MCP makes several protocol requests before its first tool call. The
      // plugin default (10 requests per day) would make normal use fail within
      // a few interactions, so keep a bounded, MCP-appropriate hourly budget.
      rateLimit: { timeWindow: 60 * 60 * 1_000, maxRequests: 1_000 },
      // API keys start read-only. Write access is deliberately requested by
      // the key creator so a routine personal key cannot mutate work data.
      permissions: { defaultPermissions: MCP_READ_PERMISSION },
    }),
    captcha({
      provider: "cloudflare-turnstile",
      // Falls back to Cloudflare's public always-pass test secret in local dev;
      // required in production (throws otherwise) so captcha can't fail open.
      secretKey: turnstileSecretKey(),
    }),
  ],
});
