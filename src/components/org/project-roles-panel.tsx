"use client";

import { IconPlus } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { ProjectRoleDialog } from "@/components/org/project-role-dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import type { ProjectRoleRow } from "@/lib/actions/project-roles";
import {
  deleteProjectRole,
  getProjectRoleDeletionImpact,
  listOrgProjectRoles,
  listProjectRoles,
  setDefaultProjectRole,
} from "@/lib/actions/project-roles";
import { PROJECT_PERMISSION_GROUPS } from "@/lib/project-permissions";

// "8 permissions · Project, People" — enough to tell roles apart at a glance
// without turning the row into a wall of keys.
function permissionSummary(role: ProjectRoleRow) {
  if (role.permissions.length === 0) return "No permissions";
  const groups = PROJECT_PERMISSION_GROUPS.filter((group) =>
    role.permissions.some((key) => key.startsWith(`${group.id}:`)),
  ).map((group) => group.label);
  const shown = groups.slice(0, 3).join(", ");
  const rest = groups.length > 3 ? `, +${groups.length - 3}` : "";
  return `${role.permissions.length} permission${
    role.permissions.length === 1 ? "" : "s"
  } · ${shown}${rest}`;
}

function RoleTable({
  roles,
  canManage,
  onEdit,
  onDelete,
  onMakeDefault,
  showDefaultAction,
}: {
  roles: ProjectRoleRow[];
  canManage: boolean;
  onEdit: (role: ProjectRoleRow) => void;
  onDelete: (role: ProjectRoleRow) => void;
  onMakeDefault: (role: ProjectRoleRow) => void;
  showDefaultAction: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-(--card-spacing)">Role</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead className="tabular-nums">People</TableHead>
          {canManage ? (
            <TableHead className="w-32 pr-(--card-spacing)" />
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.id}>
            <TableCell className="pl-(--card-spacing)">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.name}</span>
                  {role.isDefault ? (
                    <Badge variant="default">Default</Badge>
                  ) : null}
                  {role.source === "sap" ? (
                    <Badge variant="neutral">Synced</Badge>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {role.key}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {permissionSummary(role)}
            </TableCell>
            <TableCell className="tabular-nums">{role.memberCount}</TableCell>
            {canManage ? (
              <TableCell className="pr-(--card-spacing)">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onEdit(role)}
                  >
                    Edit
                  </Button>
                  {showDefaultAction && !role.isDefault ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onMakeDefault(role)}
                    >
                      Make default
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={role.isDefault}
                    title={
                      role.isDefault
                        ? "Make another role the default first."
                        : undefined
                    }
                    onClick={() => onDelete(role)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ProjectRolesPanel({
  organizationId,
  projectId = null,
  canManage,
  initialRoles,
  initialCatalog = [],
}: {
  organizationId: string;
  // null = organization catalog page; a string = a project's Roles tab.
  projectId?: string | null;
  canManage: boolean;
  initialRoles: ProjectRoleRow[];
  // Only meaningful at project scope: the read-only org roles shown below.
  initialCatalog?: ProjectRoleRow[];
}) {
  const isOrgScope = projectId === null;
  const [roles, setRoles] = useState(initialRoles);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRoleRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (isOrgScope) {
        setRoles(await listOrgProjectRoles(organizationId));
      } else {
        const { catalog: next, local } = await listProjectRoles({
          organizationId,
          projectId,
        });
        setRoles(local);
        setCatalog(next);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load roles.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [isOrgScope, organizationId, projectId]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(role: ProjectRoleRow) {
    setEditing(role);
    setDialogOpen(true);
  }

  // Ask the server how many people are affected before showing the confirm, so
  // the copy states the real number rather than a guess.
  async function openDelete(role: ProjectRoleRow) {
    setDeleteTarget(role);
    setDeleteImpact(null);
    try {
      const { holders, fallbackRoleName } = await getProjectRoleDeletionImpact({
        organizationId,
        roleId: role.id,
      });
      setDeleteImpact(
        holders === 0
          ? "No one currently has this role."
          : `${holders} ${holders === 1 ? "person" : "people"} will move to ${
              fallbackRoleName ?? "the default role"
            }.`,
      );
    } catch {
      setDeleteImpact("This can't be undone.");
    }
  }

  async function makeDefault(role: ProjectRoleRow) {
    try {
      await setDefaultProjectRole({ organizationId, roleId: role.id });
      toast.success(`${role.name} is now the default role.`);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to set the default.",
      );
    }
  }

  async function remove(role: ProjectRoleRow) {
    try {
      await deleteProjectRole({ organizationId, roleId: role.id });
      toast.warning(`${role.name} deleted.`);
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete the role.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b [.border-b]:pb-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle>
              {isOrgScope ? "Organization roles" : "Project roles"}
            </CardTitle>
            <CardDescription>
              {isOrgScope
                ? "Available on every project in this organization."
                : "Only available on this project."}
            </CardDescription>
          </div>
          {canManage ? (
            <Button onClick={openCreate}>
              <IconPlus className="size-4" />
              New role
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          {refreshing ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : roles.length === 0 ? (
            <p className="px-(--card-spacing) pt-6 text-sm text-muted-foreground">
              {isOrgScope
                ? "No roles yet. Create one to get started."
                : "No project-specific roles. Everyone here uses the organization roles below."}
            </p>
          ) : (
            <RoleTable
              roles={roles}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={openDelete}
              onMakeDefault={makeDefault}
              showDefaultAction={isOrgScope}
            />
          )}
        </CardContent>
      </Card>

      {!isOrgScope ? (
        <Card>
          <CardHeader className="border-b [.border-b]:pb-6">
            <CardTitle>Organization roles</CardTitle>
            <CardDescription>
              Managed by your organization admins. Available on every project
              and assignable here.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            {catalog.length === 0 ? (
              <p className="px-(--card-spacing) pt-6 text-sm text-muted-foreground">
                No organization roles yet.
              </p>
            ) : (
              <RoleTable
                roles={catalog}
                canManage={false}
                onEdit={openEdit}
                onDelete={openDelete}
                onMakeDefault={makeDefault}
                showDefaultAction={false}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <ProjectRoleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        projectId={projectId}
        editing={editing}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete role?"}
        description={deleteImpact ?? "Checking who this affects..."}
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
      />
    </div>
  );
}
