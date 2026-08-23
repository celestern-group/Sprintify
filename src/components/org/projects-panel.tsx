"use client";

import {
  IconFolder,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  createProject,
  deleteProject,
  getProjects,
  updateProject,
} from "@/lib/actions/projects";
import {
  deriveProjectKey,
  normalizeProjectKey,
  PROJECT_KEY_MAX_LENGTH,
} from "@/lib/project-key";

type Project = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function ProjectsPanel({
  organizationId,
  organizationName,
  organizationSlug,
  initialProjects,
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  initialProjects: Project[];
}) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Empty means "use the suggestion"; the server derives it from the name.
  const [key, setKey] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setProjects(await getProjects(organizationId));
    } finally {
      setRefreshing(false);
    }
  }, [organizationId]);

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setKey("");
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(target: Project) {
    setEditing(target);
    setName(target.name);
    setDescription(target.description ?? "");
    setKey(target.key);
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateProject({
          id: editing.id,
          organizationId,
          name,
          description,
        });
        toast.success(`${name} updated.`);
      } else {
        await createProject({ organizationId, name, description, key });
        toast.success(`${name} added.`);
      }
      setDialogOpen(false);
      resetForm();
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
    setSaving(false);
  }

  async function remove(id: string) {
    try {
      await deleteProject({ id, organizationId });
      toast.warning("Project removed.");
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete project.",
      );
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Projects"
        description={`Projects belonging to ${organizationName}.`}
      >
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          Add project
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            {projects.length} projects in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-6">
          {refreshing ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Add one to get started.
            </p>
          ) : (
            projects.map((proj) => (
              <div
                key={proj.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3"
              >
                <Link
                  href={`/manage-org/${organizationSlug}/projects/${proj.id}`}
                  className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <IconFolder className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold hover:text-primary">
                        {proj.name}
                      </span>
                      <Badge variant="secondary" className="tabular-nums">
                        {proj.key}
                      </Badge>
                    </span>
                    {proj.description ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {proj.description}
                      </span>
                    ) : null}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => openEdit(proj)}
                  >
                    <IconPencil className="size-4" />
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(proj.id)}
                  >
                    <IconTrash className="size-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit project" : "Add project"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this project's details."
                : `${organizationName} projects are visible to all members.`}
            </DialogDescription>
          </DialogHeader>
          <form
            id="project-form"
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">Name</FieldLabel>
                <Input
                  id="project-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Marketing site redesign"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-key">
                  Key{" "}
                  <span className="font-normal text-muted-foreground">
                    {editing ? "(can't be changed)" : "(optional)"}
                  </span>
                </FieldLabel>
                <Input
                  id="project-key"
                  value={key}
                  disabled={Boolean(editing)}
                  maxLength={PROJECT_KEY_MAX_LENGTH}
                  onChange={(event) =>
                    setKey(normalizeProjectKey(event.target.value))
                  }
                  placeholder={name ? deriveProjectKey(name) : "MSR"}
                  className="font-mono uppercase tabular-nums"
                  aria-describedby="project-key-hint"
                />
                <p
                  id="project-key-hint"
                  className="text-xs text-muted-foreground"
                >
                  {editing
                    ? "The key is fixed once a project is created, so links to it keep working."
                    : "Used in this project's URLs. Left blank, we'll pick one from the name."}
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-description">
                  Description{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Textarea
                  id="project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this project is for"
                />
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="submit" form="project-form" disabled={saving}>
              {saving ? <Spinner /> : null}
              {editing ? "Save changes" : "Add project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this project?"
        description="This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
      />
    </PageContainer>
  );
}
