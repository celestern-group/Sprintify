"use client";

import {
  IconFolder,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  createOrganizationProject,
  deleteOrganizationProject,
  updateOrganizationProject,
} from "@/lib/actions/admin-projects";

type ProjectRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function OrganizationProjectsPanel({
  organizationId,
  projects,
  onChanged,
}: {
  organizationId: string;
  projects: ProjectRow[];
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(target: ProjectRow) {
    setEditing(target);
    setName(target.name);
    setDescription(target.description ?? "");
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateOrganizationProject({
          id: editing.id,
          organizationId,
          name,
          description,
        });
        toast.success(`${name} updated.`);
      } else {
        await createOrganizationProject({ organizationId, name, description });
        toast.success(`${name} added.`);
      }
      setDialogOpen(false);
      resetForm();
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
    setSaving(false);
  }

  async function remove() {
    if (!deleteTarget) return;
    try {
      await deleteOrganizationProject({
        id: deleteTarget.id,
        organizationId,
      });
      toast.warning(`${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete project.",
      );
    }
  }

  return (
    <SectionCard
      title="Projects"
      description={`${projects.length} projects in this organization.`}
      action={
        <Button size="sm" onClick={openCreate}>
          <IconPlus className="size-4" />
          Add project
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          projects.map((proj) => (
            <div
              key={proj.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <IconFolder className="size-4" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {proj.name}
                  </span>
                  {proj.description ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {proj.description}
                    </span>
                  ) : null}
                </div>
              </div>
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
                  onClick={() => setDeleteTarget(proj)}
                >
                  <IconTrash className="size-4" />
                  <span className="sr-only">Delete</span>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

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
          </DialogHeader>
          <form
            id="admin-project-form"
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="admin-project-name">Name</FieldLabel>
                <Input
                  id="admin-project-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Marketing site redesign"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-project-description">
                  Description{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Textarea
                  id="admin-project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this project is for"
                />
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="submit"
              form="admin-project-form"
              disabled={saving || !name}
            >
              {saving ? <Spinner /> : null}
              {editing ? "Save changes" : "Add project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        variant="destructive"
        onConfirm={remove}
      />
    </SectionCard>
  );
}
