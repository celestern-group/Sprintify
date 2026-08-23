import { apiKeyClient } from "@better-auth/api-key/client";
import { ssoClient } from "@better-auth/sso/client";
import {
  adminClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "@/components/ui/toast";
import { ac, orgAc, orgRoles, roles } from "@/lib/permissions";

export const authClient = createAuthClient({
  fetchOptions: {
    onError: async ({ response }) => {
      if (response.status === 429) {
        const retryAfter = response.headers.get("X-Retry-After");
        toast.error(
          retryAfter
            ? `Too many attempts. Try again in ${retryAfter}s.`
            : "Too many attempts. Please try again shortly.",
        );
      }
    },
  },
  plugins: [
    // No onTwoFactorRedirect callback: sign-in call sites inspect the returned
    // `twoFactorRedirect` flag themselves so they can carry `redirectTo`
    // through to the /two-factor challenge page.
    twoFactorClient(),
    adminClient({ ac, roles }),
    ssoClient({ domainVerification: { enabled: true } }),
    organizationClient({
      ac: orgAc,
      roles: orgRoles,
      schema: {
        organization: {
          additionalFields: {
            aiPlatformAccess: {
              type: "boolean",
              required: false,
              input: false,
            },
          },
        },
      },
    }),
    apiKeyClient(),
  ],
});
