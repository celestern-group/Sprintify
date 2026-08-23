"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setActiveProject } from "@/lib/active-project";
import { findAccessibleProjectByKey } from "@/lib/project-access";
import { getUserOrganizations, requireAuth } from "@/lib/session";

const selectProjectSchema = z.object({
  orgSlug: z.string().min(1),
  projectKey: z.string().min(1),
});

/**
 * Moves the session's active-project pointer without navigating — what the
 * sidebar switcher calls while you are on an org-level section
 * (/availability), where there is no project segment in the URL to change.
 * Project-scoped routes still switch by navigating.
 *
 * Deliberately not audited: this is session view state, the same class as
 * Better Auth's setActiveOrganization, and it grants nothing — every page and
 * every action re-resolves the pointer against the caller's real project
 * access. Auditing a sidebar click would bury the log it shares with real
 * mutations.
 */
export async function selectActiveProject(input: {
  orgSlug: string;
  projectKey: string;
}): Promise<{ ok: boolean }> {
  const { orgSlug, projectKey } = selectProjectSchema.parse(input);

  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === orgSlug);
  if (!org) return { ok: false };

  const target = await findAccessibleProjectByKey(
    org.id,
    session.user.id,
    projectKey,
  );
  if (!target) return { ok: false };

  await setActiveProject({
    sessionId: session.session.id,
    currentActiveProjectId: session.session.activeProjectId,
    projectId: target.id,
  });

  // The pointer decides what the org-level pages render, so their data is
  // stale the moment it moves.
  revalidatePath("/app/[orgSlug]/availability", "page");
  revalidatePath("/app/[orgSlug]", "layout");

  return { ok: true };
}
