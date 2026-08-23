import { redirect } from "next/navigation";

/**
 * Working time moved to /manage-org/[slug]/working-time — an org-admin
 * concern now (canManageOrg), not project-scoped. The destination re-gates
 * itself, so this hop needs no permission check of its own.
 */
export default async function LegacyProjectWorkingTimePage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectKey: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/manage-org/${orgSlug}/working-time`);
}
