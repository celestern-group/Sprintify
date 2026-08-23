import { redirect } from "next/navigation";

/**
 * Working time moved to /manage-org/[slug]/working-time — it's an org-admin
 * concern now (canManageOrg), not a per-project sprint:manage one. The
 * destination re-gates itself, so this hop needs no permission check of its
 * own.
 */
export default async function LegacyOrgWorkingTimePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/manage-org/${orgSlug}/working-time`);
}
