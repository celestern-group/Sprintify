"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

export function OrgSettingsPanel({
  organizationId,
  initialName,
  initialSlug,
  projectCount,
}: {
  organizationId: string;
  initialName: string;
  initialSlug: string;
  projectCount: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [saving, setSaving] = useState(false);

  const generalDirty = name !== initialName || slug !== initialSlug;
  // Mirrors the server rule in beforeDeleteOrganization (src/lib/auth.ts): an
  // org with projects can only be deleted by a platform admin, from
  // /admin/organizations. The hook stays the enforcement point — this only
  // stops the doomed round-trip.
  const blockedByProjects = projectCount > 0;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const { error } = await authClient.organization.update({
      organizationId,
      data: { name, slug },
    });
    setSaving(false);

    if (error) {
      toast.error(error.message ?? "Unable to update organization.");
      return;
    }

    toast.success("Organization updated.");
    if (slug !== initialSlug) {
      router.push(`/manage-org/${slug}/settings`);
      return;
    }
    router.refresh();
  }

  async function remove() {
    const { error } = await authClient.organization.delete({
      organizationId,
    });

    if (error) {
      toast.error(error.message ?? "Unable to delete organization.");
      return;
    }

    toast.warning(`${initialName} deleted.`);
    router.push("/app");
    router.refresh();
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description={`Manage ${initialName}'s profile and organization-wide preferences.`}
      />

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>General</CardTitle>
          <CardDescription>
            Basic information about your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form id="org-settings-form" onSubmit={save} noValidate>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="org-settings-name">
                    Organization name
                  </FieldLabel>
                  <FieldDescription>
                    Shown to members across the dashboard.
                  </FieldDescription>
                </FieldContent>
                <Input
                  id="org-settings-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="sm:max-w-2xs"
                />
              </Field>
              <FieldSeparator />
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="org-settings-slug">URL slug</FieldLabel>
                  <FieldDescription>
                    Used in your organization's dashboard URL.
                  </FieldDescription>
                </FieldContent>
                <InputGroup className="sm:max-w-2xs">
                  <InputGroupAddon>
                    <InputGroupText>/manage-org/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="org-settings-slug"
                    required
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                </InputGroup>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-end border-t [.border-t]:pt-6">
          <Button
            type="submit"
            form="org-settings-form"
            disabled={saving || !generalDirty}
          >
            {saving ? <Spinner /> : null}
            Save changes
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-danger-border">
        <CardHeader className="border-b border-danger-border [.border-b]:pb-6">
          <div className="flex items-center gap-2 text-destructive">
            <IconAlertTriangle className="size-4" />
            <CardTitle className="text-destructive">Danger zone</CardTitle>
          </div>
          <CardDescription>
            Irreversible and destructive actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">Delete this organization</p>
              <p className="text-sm text-muted-foreground">
                {blockedByProjects ? (
                  <>
                    {initialName} still has{" "}
                    <span className="tabular-nums">{projectCount}</span>{" "}
                    {projectCount === 1 ? "project" : "projects"}. Delete{" "}
                    {projectCount === 1 ? "it" : "them"} in{" "}
                    <Link
                      href={`/manage-org/${initialSlug}/projects`}
                      className="font-semibold text-primary underline underline-offset-4"
                    >
                      Projects
                    </Link>{" "}
                    first.
                  </>
                ) : (
                  <>
                    Permanently deletes {initialName} and its members. This
                    cannot be undone.
                  </>
                )}
              </p>
            </div>
            {blockedByProjects ? (
              <Button variant="destructive" className="shrink-0" disabled>
                Delete organization
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button variant="destructive" className="shrink-0">
                    Delete organization
                  </Button>
                }
                title={<>Delete {initialName}?</>}
                description="This permanently deletes the organization and its members. This cannot be undone."
                confirmLabel="Delete"
                pendingLabel="Deleting..."
                onConfirm={remove}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
