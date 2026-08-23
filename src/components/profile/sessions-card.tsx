"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProfileSession } from "@/components/profile/types";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

export function SessionsCard({
  currentSessionToken,
}: {
  currentSessionToken: string;
}) {
  const [sessions, setSessions] = useState<ProfileSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ProfileSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    authClient.listSessions().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setLoadError(error.message ?? "Unable to load sessions.");
        return;
      }
      setSessions(data ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function revoke(token: string) {
    setRevokingToken(token);
    const { error } = await authClient.revokeSession({ token });
    setRevokingToken(null);

    if (error) {
      toast.error(error.message ?? "Unable to revoke session.");
      return;
    }

    toast.warning("Session revoked.");
    setSessions((prev) => prev?.filter((s) => s.token !== token) ?? null);
  }

  async function revokeOthers() {
    const { error } = await authClient.revokeOtherSessions();

    if (error) {
      toast.error(error.message ?? "Unable to revoke other sessions.");
      return;
    }

    toast.warning("Signed out of all other devices.");
    setSessions(
      (prev) => prev?.filter((s) => s.token === currentSessionToken) ?? null,
    );
  }

  const otherSessionsCount =
    sessions?.filter((s) => s.token !== currentSessionToken).length ?? 0;

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Devices and browsers currently signed in to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {loadError ? (
          <p className="text-sm text-muted-foreground">
            {loadError === "Session is not fresh" ? (
              <>
                You&apos;re signed in, but viewing active sessions needs a more
                recent sign-in for security. Enter your password again to
                continue —{" "}
                <Link
                  href="/sign-in?redirectTo=/profile"
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  sign in
                </Link>
                .
              </>
            ) : (
              loadError
            )}
          </p>
        ) : sessions === null ? (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => {
              const isCurrent = session.token === currentSessionToken;
              return (
                <div
                  key={session.id}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="min-w-0 truncate font-semibold">
                      {session.userAgent ?? "Unknown device"}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
                      {session.ipAddress ? `${session.ipAddress} · ` : ""}
                      Active{" "}
                      {formatDistanceToNow(new Date(session.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {isCurrent ? (
                    <Badge variant="secondary" className="shrink-0">
                      This device
                    </Badge>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={revokingToken === session.token}
                      onClick={() => setRevokeTarget(session)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {/* One dialog for the whole list — driven by the row that was clicked. */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this session?"
        description={`${revokeTarget?.userAgent ?? "That device"} is signed out of your account immediately and will need to sign in again.`}
        confirmLabel="Revoke"
        pendingLabel="Revoking..."
        onConfirm={async () => {
          if (revokeTarget) await revoke(revokeTarget.token);
        }}
      />
      {loadError ? null : (
        <CardFooter className="justify-end border-t [.border-t]:pt-6">
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={otherSessionsCount === 0}>
                Sign out of other devices
              </Button>
            }
            title="Revoke all other sessions?"
            description="Every other device signed in to your account is signed out immediately. This device stays active."
            confirmLabel="Revoke others"
            pendingLabel="Revoking..."
            onConfirm={revokeOthers}
          />
        </CardFooter>
      )}
    </Card>
  );
}
