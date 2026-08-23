"use client";

import { IconPlus } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  addProjectMember,
  getProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/lib/actions/project-members";
import type { ProjectRoleRow } from "@/lib/actions/project-roles";
import { addTeamToProject } from "@/lib/actions/teams";

type ProjectMemberRow = {
  id: string;
  memberId: string;
  roleId: string;
  userName: string;
  userEmail: string;
};

type OrgMemberOption = {
  id: string;
  name: string;
  email: string;
};

// Org catalog roles and this project's own roles are visually separated so it's
// clear which ones are shared with every other project.
function RoleOptions({ roles }: { roles: ProjectRoleRow[] }) {
  const catalog = roles.filter((role) => role.projectId === null);
  const local = roles.filter((role) => role.projectId !== null);

  return (
    <>
      {catalog.length > 0 ? (
        <NativeSelectOptGroup label="Organization roles">
          {catalog.map((role) => (
            <NativeSelectOption key={role.id} value={role.id}>
              {role.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ) : null}
      {local.length > 0 ? (
        <NativeSelectOptGroup label="This project">
          {local.map((role) => (
            <NativeSelectOption key={role.id} value={role.id}>
              {role.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ) : null}
    </>
  );
}

export function ProjectMembersPanel({
  organizationId,
  projectId,
  orgMembers,
  roles,
  initialMembers,
  teams,
}: {
  organizationId: string;
  projectId: string;
  orgMembers: OrgMemberOption[];
  roles: ProjectRoleRow[];
  initialMembers: ProjectMemberRow[];
  teams: { id: string; name: string }[];
}) {
  const defaultRoleId = useMemo(
    () => roles.find((role) => role.isDefault)?.id ?? roles[0]?.id ?? "",
    [roles],
  );

  const [members, setMembers] = useState<ProjectMemberRow[]>(initialMembers);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProjectMemberRow | null>(
    null,
  );
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState(defaultRoleId);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);

  const available = useMemo(() => {
    const taken = new Set(members.map((row) => row.memberId));
    return orgMembers.filter((option) => !taken.has(option.id));
  }, [members, orgMembers]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setMembers(await getProjectMembers({ organizationId, projectId }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load members.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [organizationId, projectId]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMemberId) return;
    setAdding(true);
    try {
      await addProjectMember({
        organizationId,
        projectId,
        memberId: selectedMemberId,
        roleId: selectedRoleId || undefined,
      });
      toast.success("Member added to project.");
      setSelectedMemberId("");
      setSelectedRoleId(defaultRoleId);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add member.",
      );
    }
    setAdding(false);
  }

  async function handleAddTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTeamId) return;
    setAddingTeam(true);
    try {
      const { added, skipped } = await addTeamToProject({
        teamId: selectedTeamId,
        projectId,
      });
      if (added === 0) {
        toast.info("Everyone on that team is already on this project.");
      } else {
        toast.success(
          `Added ${added} member${added === 1 ? "" : "s"} from the team${
            skipped > 0 ? ` (${skipped} already on the project)` : ""
          }.`,
        );
      }
      setSelectedTeamId("");
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add the team.",
      );
    }
    setAddingTeam(false);
  }

  async function changeRole(projectMemberId: string, roleId: string) {
    try {
      await updateProjectMemberRole({
        organizationId,
        projectId,
        projectMemberId,
        roleId,
      });
      toast.success("Role updated.");
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update role.",
      );
    }
  }

  async function remove(projectMemberId: string) {
    try {
      await removeProjectMember({
        organizationId,
        projectId,
        projectMemberId,
      });
      toast.warning("Member removed from project.");
      setRemoveTarget(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove member.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Add members</CardTitle>
          <CardDescription>
            Give someone from this organization a role on this project, or add a
            whole team at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-6">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everyone in this organization is already on this project.
            </p>
          ) : (
            <form
              onSubmit={handleAdd}
              noValidate
              className="flex flex-wrap items-end gap-2"
            >
              <FieldGroup className="flex-1">
                <Field>
                  <FieldLabel htmlFor="project-member">Member</FieldLabel>
                  <NativeSelect
                    id="project-member"
                    value={selectedMemberId}
                    onChange={(event) =>
                      setSelectedMemberId(event.target.value)
                    }
                  >
                    <NativeSelectOption value="">
                      Select a member
                    </NativeSelectOption>
                    {available.map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.name} — {option.email}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </FieldGroup>
              <NativeSelect
                value={selectedRoleId}
                onChange={(event) => setSelectedRoleId(event.target.value)}
                aria-label="Project role"
              >
                <RoleOptions roles={roles} />
              </NativeSelect>
              <Button type="submit" disabled={adding || !selectedMemberId}>
                {adding ? <Spinner /> : <IconPlus className="size-4" />}
                Add
              </Button>
            </form>
          )}

          {teams.length > 0 ? (
            <form
              onSubmit={handleAddTeam}
              noValidate
              className="flex flex-wrap items-end gap-2 border-t pt-4"
            >
              <FieldGroup className="flex-1">
                <Field>
                  <FieldLabel htmlFor="project-team">
                    Add a team{" "}
                    <span className="font-normal text-muted-foreground">
                      (members join with the default role)
                    </span>
                  </FieldLabel>
                  <NativeSelect
                    id="project-team"
                    value={selectedTeamId}
                    onChange={(event) => setSelectedTeamId(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Select a team
                    </NativeSelectOption>
                    {teams.map((team) => (
                      <NativeSelectOption key={team.id} value={team.id}>
                        {team.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                variant="outline"
                disabled={addingTeam || !selectedTeamId}
              >
                {addingTeam ? <Spinner /> : <IconPlus className="size-4" />}
                Add team
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Project members</CardTitle>
          <CardDescription>
            Roles apply to this project only — someone can be a product owner
            here and a developer elsewhere.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          {refreshing ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : members.length === 0 ? (
            <p className="px-(--card-spacing) pt-6 text-sm text-muted-foreground">
              No members yet. Add someone above to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-(--card-spacing)">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-24 pr-(--card-spacing)" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-(--card-spacing)">
                      <UserGlimpse
                        projectId={projectId}
                        seed={{
                          memberId: row.memberId,
                          name: row.userName,
                          email: row.userEmail,
                        }}
                      >
                        {row.userName}
                      </UserGlimpse>
                    </TableCell>
                    <TableCell>{row.userEmail}</TableCell>
                    <TableCell>
                      <NativeSelect
                        value={row.roleId}
                        aria-label={`Role for ${row.userName}`}
                        onChange={(event) =>
                          changeRole(row.id, event.target.value)
                        }
                      >
                        <RoleOptions roles={roles} />
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="pr-(--card-spacing)">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setRemoveTarget(row)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove from project?"
        description={
          removeTarget
            ? `${removeTarget.userName} will lose their role on this project. They stay in the organization.`
            : undefined
        }
        confirmLabel="Remove"
        pendingLabel="Removing..."
        variant="destructive"
        onConfirm={async () => {
          if (removeTarget) await remove(removeTarget.id);
        }}
      />
    </div>
  );
}
