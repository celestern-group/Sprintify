"use client";

import {
  IconChevronDown,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeamMembers,
  getTeams,
  removeTeamMember,
  updateTeam,
} from "@/lib/actions/teams";

type Team = Awaited<ReturnType<typeof getTeams>>[number];
type TeamMemberRow = Awaited<ReturnType<typeof getTeamMembers>>[number];
type OrgMember = { id: string; name: string; email: string };

// Searchable picker over the members not yet on the team. `available` is
// already loaded client-side, so we filter locally (filter={null} disables the
// built-in one) — no server round-trip. Selecting a member adds them and
// resets the input, since this is an "add" action rather than a held value.
function AddMemberCombobox({
  available,
  onAdd,
}: {
  available: OrgMember[];
  onAdd: (memberId: string) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const query = inputValue.trim().toLowerCase();
  const filtered = query
    ? available.filter((m) =>
        `${m.name} ${m.email}`.toLowerCase().includes(query),
      )
    : available;

  return (
    <Combobox<OrgMember>
      items={filtered}
      filter={null}
      value={null}
      onValueChange={(member) => {
        if (member) {
          onAdd(member.id);
          setInputValue("");
        }
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      itemToStringLabel={(m) => (m ? `${m.name} — ${m.email}` : "")}
      isItemEqualToValue={(a, b) => a.id === b.id}
    >
      <ComboboxInput
        placeholder="Search members to add…"
        aria-label="Add a member to this team"
        showClear
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No members found.</ComboboxEmpty>
          {filtered.map((m) => (
            <ComboboxItem key={m.id} value={m}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {m.email}
                </span>
              </div>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function TeamsPanel({
  organizationId,
  organizationName,
  initialTeams,
  orgMembers,
}: {
  organizationId: string;
  organizationName: string;
  initialTeams: Team[];
  orgMembers: OrgMember[];
}) {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  const refreshTeams = useCallback(async () => {
    setTeams(await getTeams(organizationId));
  }, [organizationId]);

  const loadMembers = useCallback(async (teamId: string) => {
    setLoadingMembers(true);
    try {
      setMembers(await getTeamMembers(teamId));
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  async function toggleExpand(teamId: string) {
    if (expandedId === teamId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(teamId);
    await loadMembers(teamId);
  }

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setDialogOpen(true);
  }

  function openEdit(team: Team) {
    setEditing(team);
    setName(team.name);
    setDescription(team.description ?? "");
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateTeam({ teamId: editing.id, name, description });
        toast.success(`${name} updated.`);
      } else {
        await createTeam({ organizationId, name, description });
        toast.success(`${name} created.`);
      }
      setDialogOpen(false);
      await refreshTeams();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
    setSaving(false);
  }

  async function remove(team: Team) {
    try {
      await deleteTeam({ teamId: team.id });
      toast.warning("Team deleted.");
      setDeleteTarget(null);
      if (expandedId === team.id) setExpandedId(null);
      await refreshTeams();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete team.",
      );
    }
  }

  async function addMember(teamId: string, memberId: string) {
    try {
      await addTeamMember({ teamId, memberId });
      await Promise.all([loadMembers(teamId), refreshTeams()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add member.",
      );
    }
  }

  async function removeMember(teamId: string, memberId: string) {
    try {
      await removeTeamMember({ teamId, memberId });
      await Promise.all([loadMembers(teamId), refreshTeams()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove member.",
      );
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Teams"
        description={`Group ${organizationName} members into teams for assigning and filtering work. Teams don't grant access on their own.`}
      >
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          Add team
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Teams</CardTitle>
          <CardDescription>
            {teams.length} teams in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-6">
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No teams yet. Add one to get started.
            </p>
          ) : (
            teams.map((team) => {
              const expanded = expandedId === team.id;
              const available = orgMembers.filter(
                (m) => !members.some((tm) => tm.memberId === m.id),
              );
              return (
                <div key={team.id} className="rounded-md border">
                  <div className="flex min-w-0 items-center justify-between gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(team.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                        <IconUsersGroup className="size-4" />
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold">
                          {team.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {team.memberCount}{" "}
                          {team.memberCount === 1 ? "member" : "members"}
                        </span>
                      </div>
                      <IconChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(team)}
                      >
                        <IconPencil className="size-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(team)}
                      >
                        <IconTrash className="size-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="flex flex-col gap-3 border-t p-3">
                      {loadingMembers ? (
                        <div className="flex justify-center p-2">
                          <Spinner />
                        </div>
                      ) : (
                        <>
                          {members.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No members on this team yet.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {members.map((m) => (
                                <li
                                  key={m.id}
                                  className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                                >
                                  <div className="flex min-w-0 flex-col">
                                    <UserGlimpse
                                      className="truncate text-sm"
                                      seed={{
                                        memberId: m.memberId,
                                        name: m.userName,
                                        email: m.userEmail,
                                      }}
                                    >
                                      {m.userName}
                                    </UserGlimpse>
                                    <span className="truncate text-xs text-muted-foreground">
                                      {m.userEmail}
                                    </span>
                                  </div>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="shrink-0"
                                    onClick={() =>
                                      removeMember(team.id, m.memberId)
                                    }
                                  >
                                    <IconX className="size-4" />
                                    <span className="sr-only">Remove</span>
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}

                          {available.length > 0 ? (
                            <AddMemberCombobox
                              available={available}
                              onAdd={(memberId) => addMember(team.id, memberId)}
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Everyone in the organization is already on this
                              team.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit team" : "Add team"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this team's details. Manage its members from the team row."
                : "Create a team, then add members from the team row."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="team-form"
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="team-name">Name</FieldLabel>
                <Input
                  id="team-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Platform team"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="team-description">
                  Description{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Textarea
                  id="team-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this team is responsible for"
                />
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="submit" form="team-form" disabled={saving || !name}>
              {saving ? <Spinner /> : null}
              {editing ? "Save changes" : "Add team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this team?"
        description="This removes the team and its member list. The people stay in the organization."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
      />
    </PageContainer>
  );
}
