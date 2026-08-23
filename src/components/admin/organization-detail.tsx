"use client";

import { IconCrown, IconDotsVertical } from "@tabler/icons-react";
import { format } from "date-fns";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OrganizationProjectsPanel } from "@/components/admin/organization-projects-panel";
import { OrganizationRowMenu } from "@/components/admin/organization-row-menu";
import { type PickedUser, UserPicker } from "@/components/admin/user-picker";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
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
  addOrganizationMember,
  assignOrganizationOwner,
  getOrganization,
  type OrganizationDetail as OrganizationDetailData,
  type OrganizationMemberRow,
  removeOrganizationMember,
  setMemberRole,
} from "@/lib/actions/admin-organizations";
import { listOrganizationProjects } from "@/lib/actions/admin-projects";

function ReassignOwnerDialog({
  organizationId,
  open,
  onOpenChange,
  onDone,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    try {
      await assignOrganizationOwner(organizationId, picked.id);
      toast.success(`${picked.name} is now the owner.`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to reassign owner.",
      );
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign owner</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="reassign-owner-picker">New owner</FieldLabel>
          <UserPicker
            id="reassign-owner-picker"
            value={picked}
            onValueChange={setPicked}
          />
        </div>
        <DialogFooter className="mt-4">
          <Button disabled={!picked || saving} onClick={confirm}>
            {saving ? <Spinner /> : null}
            Make owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({
  organizationId,
  open,
  onOpenChange,
  onDone,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setRole("member");
    }
  }, [open]);

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    try {
      await addOrganizationMember(organizationId, picked.id, role);
      toast.success(`${picked.name} added as ${role}.`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add member.",
      );
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="add-member-picker">User</FieldLabel>
            <UserPicker
              id="add-member-picker"
              value={picked}
              onValueChange={setPicked}
            />
          </div>
          <Field>
            <FieldLabel htmlFor="add-member-role">Role</FieldLabel>
            <NativeSelect
              id="add-member-role"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as "member" | "admin")
              }
            >
              <NativeSelectOption value="member">member</NativeSelectOption>
              <NativeSelectOption value="admin">admin</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter className="mt-4">
          <Button disabled={!picked || saving} onClick={confirm}>
            {saving ? <Spinner /> : null}
            Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberRowMenu({
  member,
  organizationId,
  onChanged,
}: {
  member: OrganizationMemberRow;
  organizationId: string;
  onChanged: () => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);

  async function makeOwner() {
    try {
      await assignOrganizationOwner(organizationId, member.userId);
      toast.success(`${member.name} is now the owner.`);
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to reassign owner.",
      );
    }
  }

  async function remove() {
    try {
      await removeOrganizationMember(organizationId, member.id);
      toast.warning(`${member.name} removed.`);
      setRemoveOpen(false);
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove member.",
      );
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <IconDotsVertical />
              <span className="sr-only">Actions</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={makeOwner}>Make owner</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${member.name}?`}
        description="They will lose access to this organization."
        confirmLabel="Remove"
        pendingLabel="Removing..."
        variant="destructive"
        onConfirm={remove}
      />
    </>
  );
}

export function OrganizationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [org, setOrg] = useState<OrganizationDetailData | null>(null);
  const [projects, setProjects] = useState<
    Awaited<ReturnType<typeof listOrganizationProjects>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [nextOrg, nextProjects] = await Promise.all([
      getOrganization(id),
      listOrganizationProjects(id),
    ]);
    setLoading(false);
    if (!nextOrg) {
      setNotFoundError(true);
      return;
    }
    setOrg(nextOrg);
    setProjects(nextProjects);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFoundError) {
    notFound();
  }

  if (loading || !org) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  const owner = org.members.find((member) => member.role === "owner");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform admin"
        title={org.name}
        description={org.slug}
        backHref="/admin/organizations"
        backLabel="Organizations"
      >
        <OrganizationRowMenu
          organization={org}
          onChanged={load}
          onDeleted={() => router.push("/admin/organizations")}
        />
      </PageHeader>

      <SectionCard title="Overview">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Slug</dt>
            <dd className="text-sm">{org.slug}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd className="text-sm tabular-nums">
              {format(new Date(org.createdAt), "MMM d, yyyy")}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Members</dt>
            <dd className="text-sm tabular-nums">{org.members.length}</dd>
          </div>
        </dl>
      </SectionCard>

      <OrganizationProjectsPanel
        organizationId={org.id}
        projects={projects}
        onChanged={load}
      />

      <SectionCard
        title="Work items"
        description="This organization's work item types and custom fields — the vocabulary every project plans in."
        action={
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            nativeButton={false}
            render={<Link href={`/admin/organizations/${org.id}/work-items`} />}
          >
            Configure
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Types decide what an item can be (Epic, Story, Bug) and which of them
          carry the defect fields; custom fields add whatever else this
          organization tracks.
        </p>
      </SectionCard>

      <SectionCard
        title="Owner & members"
        description={`${org.members.length} member${org.members.length === 1 ? "" : "s"} in this organization.`}
        action={
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => setAddMemberOpen(true)}
          >
            Add member
          </Button>
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <IconCrown className="size-4" />
              </div>
              {owner ? (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {owner.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {owner.email}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No owner assigned
                </span>
              )}
            </div>
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={() => setReassignOpen(true)}
            >
              Reassign owner
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-0">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-10 pr-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No members yet.
                  </TableCell>
                </TableRow>
              ) : (
                org.members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="pl-0">{member.name}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      {member.role === "owner" ? (
                        <Badge variant="neutral">owner</Badge>
                      ) : (
                        <NativeSelect
                          size="sm"
                          value={member.role}
                          onChange={(event) =>
                            setMemberRole(
                              org.id,
                              member.id,
                              event.target.value as "member" | "admin",
                            )
                              .then(load)
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Unable to update role.",
                                ),
                              )
                          }
                        >
                          <NativeSelectOption value="member">
                            member
                          </NativeSelectOption>
                          <NativeSelectOption value="admin">
                            admin
                          </NativeSelectOption>
                        </NativeSelect>
                      )}
                    </TableCell>
                    <TableCell className="pr-0">
                      {member.role !== "owner" ? (
                        <MemberRowMenu
                          member={member}
                          organizationId={org.id}
                          onChanged={load}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <ReassignOwnerDialog
        organizationId={org.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        onDone={load}
      />

      <AddMemberDialog
        organizationId={org.id}
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        onDone={load}
      />
    </PageContainer>
  );
}
