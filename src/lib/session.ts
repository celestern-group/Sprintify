import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasAdminRole } from "@/lib/roles";

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireAuth() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (!hasAdminRole(session.user.role)) redirect("/app");
  return session;
}

/**
 * Platform-admin gate for server actions. Throws rather than redirecting —
 * `requireAdmin()` above is the layout/page variant, and a redirect thrown from
 * inside an action surfaces to the client as an opaque failure instead of a
 * message the panel can show.
 */
export async function requireAdminAction() {
  const session = await getSession();
  if (!session || !hasAdminRole(session.user.role)) {
    throw new Error("Admins only.");
  }
  return session;
}

export type UserOrganization = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: string;
};

export const getUserOrganizations = cache(
  async (userId: string): Promise<UserOrganization[]> => {
    return db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId));
  },
);
