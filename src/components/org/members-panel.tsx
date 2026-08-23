"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { AddMemberForm } from "@/components/org/add-member-form";
import { InviteMemberForm } from "@/components/org/invite-member-form";
import type { FullOrganization } from "@/components/org/types";
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
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  listPendingMemberActivations,
  resendMemberActivation,
} from "@/lib/actions/org-members";
import { authClient } from "@/lib/auth-client";

export function MembersPanel({ slug }: { slug: string }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [org, setOrg] = useState<FullOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  // Member ids whose accounts were provisioned by an admin and never activated
  // — `getFullOrganization` can't know this, it's a credential-account fact.
  const [pendingActivation, setPendingActivation] = useState<Set<string>>(
    () => new Set(),
  );
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await authClient.organization.getFullOrganization({
      query: { organizationSlug: slug },
    });
    if (error || !data) {
      setLoadError(error?.message ?? "The member list couldn't be loaded.");
      setLoading(false);
      return;
    }
    setOrg(data);
    setLoading(false);
    // Secondary, non-blocking: the roster renders without it, and a failure
    // here just means no "Pending activation" badges this pass.
    try {
      const pending = await listPendingMemberActivations({
        organizationId: data.id,
      });
      setPendingActivation(new Set(pending));
    } catch {
      setPendingActivation(new Set());
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(memberId: string, role: string) {
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role: role as "member" | "admin" | "owner",
    });
    if (error) {
      toast.error(error.message ?? "Unable to update role.");
      return;
    }
    toast.success("Role updated.");
    load();
  }

  async function removeMember(memberIdOrEmail: string) {
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail,
    });
    if (error) {
      toast.error(error.message ?? "Unable to remove member.");
      return;
    }
    toast.warning("Member removed.");
    setRemoveTarget(null);
    load();
  }

  async function leave() {
    if (!org) return;
    const { error } = await authClient.organization.leave({
      organizationId: org.id,
    });
    if (error) {
      toast.error(error.message ?? "Unable to leave organization.");
      return;
    }
    toast.warning(`You left ${org.name}.`);
    router.push("/app");
    router.refresh();
  }

  async function resendActivation(memberId: string) {
    if (!org) return;
    setResendingId(memberId);
    try {
      const { email } = await resendMemberActivation({
        organizationId: org.id,
        memberId,
      });
      toast.success(`Sent a new set-password link to ${email}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to resend the activation link.",
      );
      // The most likely failure is "they've already activated", which the
      // badge is now wrong about — refresh so it disappears.
      load();
    } finally {
      setResendingId(null);
    }
  }

  async function cancelInvitation(invitationId: string) {
    const { error } = await authClient.organization.cancelInvitation({
      invitationId,
    });
    if (error) {
      toast.error(error.message ?? "Unable to cancel invitation.");
      return;
    }
    toast.info("Invitation cancelled.");
    load();
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-8">
        {Array.from({ length: 6 }, (_, index) => index).map((row) => (
          <Skeleton key={row} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (loadError || !org) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-destructive">
          {loadError ?? "The member list couldn't be loaded."}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const pendingInvitations = org.invitations.filter(
    (invite) => invite.status === "pending",
  );
  const currentUserId = session.data?.user.id;
  // Direct adds need `member:create`, which only owner/admin hold (orgRoles in
  // src/lib/permissions.ts). The server action re-checks — this just keeps the
  // tab out of a plain member's way. Roles can be a comma-separated list.
  const currentRoles =
    org.members
      .find((row) => row.userId === currentUserId)
      ?.role.split(",")
      .map((value) => value.trim()) ?? [];
  const canAddDirectly =
    currentRoles.includes("owner") || currentRoles.includes("admin");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="Members"
        description={`${org.members.length} member${org.members.length === 1 ? "" : "s"} in this organization.`}
      />

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Add people</CardTitle>
          <CardDescription>
            {canAddDirectly
              ? "Invite someone and let them accept, or add them straight away."
              : "Send an email invitation to join this organization."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {canAddDirectly ? (
            <Tabs defaultValue="invite" className="gap-4">
              <TabsList>
                <TabsTrigger value="invite">Invite by email</TabsTrigger>
                <TabsTrigger value="add">Add directly</TabsTrigger>
              </TabsList>
              <TabsContent value="invite" className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">
                  They get an invitation email and join once they accept it.
                </p>
                <InviteMemberForm onInvited={load} />
              </TabsContent>
              <TabsContent value="add" className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">
                  They join immediately, no acceptance needed. If the address
                  has no account yet, we create one and email them a link to set
                  a password.
                </p>
                <AddMemberForm organizationId={org.id} onAdded={load} />
              </TabsContent>
            </Tabs>
          ) : (
            <InviteMemberForm onInvited={load} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>All members</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-(--card-spacing)">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-44 pr-(--card-spacing)" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="pl-(--card-spacing)">
                    {member.user.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0">{member.user.email}</span>
                      {pendingActivation.has(member.id) ? (
                        <Badge variant="warning">Pending activation</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {member.role === "owner" ? (
                      <Badge variant="neutral">owner</Badge>
                    ) : (
                      <NativeSelect
                        value={member.role}
                        onChange={(event) =>
                          changeRole(member.id, event.target.value)
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
                  <TableCell className="pr-(--card-spacing)">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Same `member:create` grant the server action checks. */}
                      {canAddDirectly && pendingActivation.has(member.id) ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={resendingId === member.id}
                          onClick={() => resendActivation(member.id)}
                        >
                          {resendingId === member.id ? <Spinner /> : null}
                          Resend link
                        </Button>
                      ) : null}
                      {member.role !== "owner" ? (
                        member.userId === currentUserId ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setLeaveOpen(true)}
                          >
                            Leave
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setRemoveTarget(member.id)}
                          >
                            Remove
                          </Button>
                        )
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pendingInvitations.length > 0 ? (
        <Card>
          <CardHeader className="border-b [.border-b]:pb-6">
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              {pendingInvitations.length} invitation
              {pendingInvitations.length === 1 ? "" : "s"} awaiting a response.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-6">
            {pendingInvitations.map((invite) => (
              <div
                key={invite.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span className="min-w-0 truncate">
                  {invite.email} · {invite.role}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="warning">Pending</Badge>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setCancelTarget(invite.id)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member?"
        description="They will lose access to this organization."
        confirmLabel="Remove"
        pendingLabel="Removing..."
        onConfirm={async () => {
          if (removeTarget) await removeMember(removeTarget);
        }}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this organization?"
        description="You will lose access to this organization and will need a new invitation to rejoin."
        confirmLabel="Leave"
        pendingLabel="Leaving..."
        onConfirm={leave}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel this invitation?"
        description="The invite link will stop working and the recipient will no longer be able to join."
        confirmLabel="Cancel invitation"
        pendingLabel="Cancelling..."
        cancelLabel="Keep invitation"
        onConfirm={async () => {
          if (cancelTarget) await cancelInvitation(cancelTarget);
        }}
      />
    </PageContainer>
  );
}
