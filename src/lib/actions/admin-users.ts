"use server";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { account, ssoProviderProfile } from "@/db/schema";
import { getUserOrganizations, requireAdminAction } from "@/lib/session";

export type { UserOrganization } from "@/lib/session";

export type UserSignInMethod = {
  providerId: string;
  isCredential: boolean;
  displayName: string | null;
  iconKey: string | null;
  createdAt: Date;
};

export async function getUsersSignInMethods(
  userIds: string[],
): Promise<Record<string, UserSignInMethod[]>> {
  await requireAdminAction();
  if (userIds.length === 0) return {};

  const rows = await db
    .select({
      userId: account.userId,
      providerId: account.providerId,
      createdAt: account.createdAt,
      displayName: ssoProviderProfile.displayName,
      iconKey: ssoProviderProfile.iconKey,
    })
    .from(account)
    .leftJoin(
      ssoProviderProfile,
      eq(account.providerId, ssoProviderProfile.providerId),
    )
    .where(inArray(account.userId, userIds));

  const byUser: Record<string, UserSignInMethod[]> = {};
  for (const row of rows) {
    if (!byUser[row.userId]) byUser[row.userId] = [];
    byUser[row.userId].push({
      providerId: row.providerId,
      isCredential: row.providerId === "credential",
      displayName: row.displayName,
      iconKey: row.iconKey,
      createdAt: row.createdAt,
    });
  }
  return byUser;
}

export async function getUserOrganizationsAdmin(userId: string) {
  await requireAdminAction();
  return getUserOrganizations(userId);
}
