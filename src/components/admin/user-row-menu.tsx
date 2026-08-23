"use client";

import {
  IconDotsVertical,
  IconKey,
  IconLogin2,
  IconShieldOff,
  IconTrash,
  IconUserOff,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminUser } from "@/components/admin/types";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

type DialogKind = "role" | "ban" | "password" | "sessions" | "remove" | null;

export function UserRowMenu({
  user,
  onChanged,
}: {
  user: AdminUser;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);

  async function unban() {
    const { error } = await authClient.admin.unbanUser({ userId: user.id });
    if (error) {
      toast.error(error.message ?? "Unable to unban user.");
      return;
    }
    toast.success(`${user.email} unbanned.`);
    onChanged();
  }

  async function impersonate() {
    const { error } = await authClient.admin.impersonateUser({
      userId: user.id,
    });
    if (error) {
      toast.error(error.message ?? "Unable to impersonate user.");
      return;
    }
    toast.info(`Impersonating ${user.email}.`);
    router.push("/app");
    router.refresh();
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
          <DropdownMenuItem onClick={() => setDialog("role")}>
            <IconShieldOff />
            Set role
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("sessions")}>
            <IconLogin2 />
            View sessions
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("password")}>
            <IconKey />
            Set password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={impersonate}>
            <IconLogin2 />
            Impersonate
          </DropdownMenuItem>
          {user.banned ? (
            <DropdownMenuItem onClick={unban}>
              <IconUserOff />
              Unban
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setDialog("ban")}>
              <IconUserOff />
              Ban
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog("remove")}
          >
            <IconTrash />
            Remove user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SetRoleDialog
        user={user}
        open={dialog === "role"}
        onOpenChange={(open) => setDialog(open ? "role" : null)}
        onDone={onChanged}
      />
      <BanUserDialog
        user={user}
        open={dialog === "ban"}
        onOpenChange={(open) => setDialog(open ? "ban" : null)}
        onDone={onChanged}
      />
      <SetPasswordDialog
        user={user}
        open={dialog === "password"}
        onOpenChange={(open) => setDialog(open ? "password" : null)}
      />
      <SessionsDialog
        user={user}
        open={dialog === "sessions"}
        onOpenChange={(open) => setDialog(open ? "sessions" : null)}
      />
      <RemoveUserDialog
        user={user}
        open={dialog === "remove"}
        onOpenChange={(open) => setDialog(open ? "remove" : null)}
        onDone={onChanged}
      />
    </>
  );
}

function SetRoleDialog({
  user,
  open,
  onOpenChange,
  onDone,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState(user.role ?? "user");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    const { error } = await authClient.admin.setRole({
      userId: user.id,
      role: role as "user" | "admin" | "superadmin",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Unable to set role.");
      return;
    }
    toast.success(`${user.email} is now ${role}.`);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">Set role for</span>
            <span className="min-w-0 truncate">{user.email}</span>
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="role-select">Role</FieldLabel>
            <NativeSelect
              id="role-select"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <NativeSelectOption value="user">user</NativeSelectOption>
              <NativeSelectOption value="admin">admin</NativeSelectOption>
              <NativeSelectOption value="superadmin">
                superadmin
              </NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
        <DialogFooter className="mt-4">
          <Button onClick={submit} disabled={loading}>
            {loading ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BanUserDialog({
  user,
  open,
  onOpenChange,
  onDone,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    const { error } = await authClient.admin.banUser({
      userId: user.id,
      banReason: reason || undefined,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Unable to ban user.");
      return;
    }
    toast.warning(`${user.email} banned.`);
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">Ban</span>
            <span className="min-w-0 truncate">{user.email}</span>
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ban-reason">Reason (optional)</FieldLabel>
            <Input
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter className="mt-4">
          <Button variant="destructive" onClick={submit} disabled={loading}>
            {loading ? <Spinner /> : null}
            Ban user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    const { error } = await authClient.admin.setUserPassword({
      userId: user.id,
      newPassword: password,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Unable to set password.");
      return;
    }
    toast.success(`Password updated for ${user.email}.`);
    setPassword("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">Set password for</span>
            <span className="min-w-0 truncate">{user.email}</span>
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter className="mt-4">
          <Button onClick={submit} disabled={loading || password.length < 8}>
            {loading ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sessions, setSessions] = useState<
    { token: string; ipAddress?: string | null; userAgent?: string | null }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Don't leave a confirmation stranded if the sessions dialog is closed.
      setRevokeTarget(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    authClient.admin
      .listUserSessions({ userId: user.id })
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error) {
          toast.error(error.message ?? "Unable to load sessions.");
          return;
        }
        setSessions(data?.sessions ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [open, user.id]);

  async function revoke(token: string) {
    const { error } = await authClient.admin.revokeUserSession({
      sessionToken: token,
    });
    if (error) {
      toast.error(error.message ?? "Unable to revoke session.");
      return;
    }
    toast.warning("Session revoked.");
    setSessions((prev) => prev.filter((s) => s.token !== token));
  }

  async function revokeAll() {
    const { error } = await authClient.admin.revokeUserSessions({
      userId: user.id,
    });
    if (error) {
      toast.error(error.message ?? "Unable to revoke sessions.");
      return;
    }
    toast.warning("All sessions revoked.");
    setSessions([]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">Sessions for</span>
            <span className="min-w-0 truncate">{user.email}</span>
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => (
              <div
                key={session.token}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {session.userAgent ?? "Unknown device"}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setRevokeTarget(session.token)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="mt-4">
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={sessions.length === 0}>
                Revoke all
              </Button>
            }
            title="Revoke all sessions?"
            description={`Every device signed in as ${user.email} will be signed out immediately.`}
            confirmLabel="Revoke all"
            pendingLabel="Revoking..."
            variant="destructive"
            onConfirm={revokeAll}
          />
        </DialogFooter>

        <ConfirmDialog
          open={revokeTarget !== null}
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          title="Revoke this session?"
          description="The device using this session will be signed out immediately."
          confirmLabel="Revoke"
          pendingLabel="Revoking..."
          variant="destructive"
          onConfirm={async () => {
            if (revokeTarget) await revoke(revokeTarget);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RemoveUserDialog({
  user,
  open,
  onOpenChange,
  onDone,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  async function submit() {
    const { error } = await authClient.admin.removeUser({ userId: user.id });
    if (error) {
      toast.error(error.message ?? "Unable to remove user.");
      return;
    }
    toast.warning(`${user.email} removed.`);
    onOpenChange(false);
    onDone();
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">Remove</span>
          <span className="min-w-0 truncate">{user.email}</span>
          <span className="shrink-0">?</span>
        </span>
      }
      description="This permanently deletes the user. This cannot be undone."
      confirmLabel="Remove"
      pendingLabel="Removing..."
      variant="destructive"
      onConfirm={submit}
    />
  );
}
