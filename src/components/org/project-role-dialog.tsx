"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { ProjectRoleRow } from "@/lib/actions/project-roles";
import {
  createProjectRole,
  updateProjectRole,
} from "@/lib/actions/project-roles";
import {
  PROJECT_PERMISSION_GROUPS,
  PROJECT_PERMISSIONS,
  slugifyRoleKey,
} from "@/lib/project-permissions";

export function ProjectRoleDialog({
  open,
  onOpenChange,
  organizationId,
  projectId,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  // null = the organization catalog, a string = local to that project.
  projectId: string | null;
  editing: ProjectRoleRow | null;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setPermissions(editing ? [...editing.permissions] : []);
    setIsDefault(editing?.isDefault ?? false);
  }, [open, editing]);

  function toggle(key: string, checked: boolean) {
    setPermissions((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateProjectRole({
          organizationId,
          roleId: editing.id,
          name,
          description,
          permissions,
          isDefault,
        });
        toast.success(`${name} updated.`);
      } else {
        await createProjectRole({
          organizationId,
          projectId,
          name,
          description,
          permissions,
          isDefault,
        });
        toast.success(`${name} created.`);
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save the role.",
      );
    }
    setSaving(false);
  }

  const isOrgScope = projectId === null;
  const keyPreview = editing?.key ?? slugifyRoleKey(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit role" : "New role"}</DialogTitle>
          <DialogDescription>
            {isOrgScope
              ? "Organization roles are available on every project."
              : "This role is only available on this project."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="project-role-form"
          onSubmit={handleSubmit}
          noValidate
          className="flex min-w-0 flex-col gap-5"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="role-name">Name</FieldLabel>
              <Input
                id="role-name"
                required
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="QA lead"
              />
              {keyPreview ? (
                <FieldDescription>
                  Key: <span className="font-mono">{keyPreview}</span>
                  {editing
                    ? " — used for integrations, so it can't be changed."
                    : null}
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="role-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this role is responsible for"
              />
            </Field>

            {isOrgScope ? (
              <Field>
                <label
                  htmlFor="role-default"
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>Default role</span>
                  <Switch
                    id="role-default"
                    checked={isDefault}
                    onCheckedChange={(checked) =>
                      setIsDefault(checked === true)
                    }
                  />
                </label>
                <FieldDescription>
                  New project members get this role, and anyone whose role is
                  deleted moves here.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Permissions
            </span>
            <div className="flex max-h-[45vh] flex-col gap-4 overflow-y-auto rounded-md border p-3">
              {PROJECT_PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.id} className="flex flex-col gap-2">
                  <legend className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </legend>
                  {PROJECT_PERMISSIONS.filter(
                    (permission) => permission.group === group.id,
                  ).map((permission) => (
                    <label
                      key={permission.key}
                      htmlFor={`perm-${permission.key}`}
                      className="flex min-w-0 items-center gap-2 text-sm font-normal"
                    >
                      <Checkbox
                        id={`perm-${permission.key}`}
                        checked={permissions.includes(permission.key)}
                        onCheckedChange={(checked) =>
                          toggle(permission.key, checked === true)
                        }
                      />
                      <span
                        className={
                          permission.enforced ? "" : "text-muted-foreground"
                        }
                      >
                        {permission.label}
                      </span>
                      {permission.enforced ? null : (
                        <Badge variant="secondary">Not enforced yet</Badge>
                      )}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <FieldDescription>
              Permissions marked “Not enforced yet” can be set now and take
              effect when that feature ships.
            </FieldDescription>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="project-role-form"
            disabled={saving || !name.trim()}
          >
            {saving ? <Spinner /> : null}
            {editing ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
