import { IconRocket } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { resolveActiveProject } from "@/lib/active-project";
import { getUserOrganizations, requireAuth } from "@/lib/session";

/**
 * The org home is a doorway, not a destination: work happens inside a project,
 * so anyone who can open one is sent straight there — the session's active
 * project when there is one, otherwise the first they can open. Only a caller
 * with no project at all stays here, which is what makes this the "nothing to
 * open yet" state rather than a dashboard nobody asked for.
 */
export default async function OrgDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireAuth();
  const organizations = await getUserOrganizations(session.user.id);
  const org = organizations.find((candidate) => candidate.slug === orgSlug);
  if (!org) redirect("/app");

  const active = await resolveActiveProject({
    organizationId: org.id,
    userId: session.user.id,
    activeProjectId: session.session.activeProjectId,
  });
  if (active) redirect(`/app/${org.slug}/${active.key}`);

  return (
    <PageContainer width="full">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
          Overview
        </div>
        <h1 className="mt-1.5 font-heading text-2xl font-extrabold tracking-tight sm:text-3xl">
          No projects yet
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sprints, capacity and availability all live inside a project.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-12 text-center shadow-card">
        <div className="grid size-11 place-items-center rounded-md bg-secondary text-secondary-foreground">
          <IconRocket className="size-5" />
        </div>
        <p className="text-sm font-semibold">Nothing to open</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          You're not on a project in this organization yet. Ask an owner or
          admin to add you to one, or create the first project from the
          organization's management area.
        </p>
      </div>
    </PageContainer>
  );
}
