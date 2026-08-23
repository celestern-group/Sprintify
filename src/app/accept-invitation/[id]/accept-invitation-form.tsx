"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type InvitationState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string }
  | { status: "ready"; organizationName: string }
  | { status: "accepted" }
  | { status: "declined" };

export function AcceptInvitationForm({
  signUpEnabled,
}: {
  signUpEnabled: boolean;
}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<InvitationState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const redirectTo = `/accept-invitation/${params.id}`;

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id: params.id },
      });

      if (cancelled) return;

      if (error || !data) {
        if (error?.message === "Not authenticated") {
          setState({ status: "unauthenticated" });
          return;
        }
        setState({
          status: "error",
          message:
            error?.message ??
            "This invitation is invalid, expired, or has already been used.",
        });
        return;
      }

      setState({ status: "ready", organizationName: data.organizationName });
    }

    loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleAccept() {
    setSubmitting(true);
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: params.id,
    });
    setSubmitting(false);

    if (error) {
      setState({
        status: "error",
        message: error.message ?? "Unable to accept invitation.",
      });
      return;
    }

    setState({ status: "accepted" });
    router.push("/app");
  }

  async function handleDecline() {
    setSubmitting(true);
    await authClient.organization.rejectInvitation({
      invitationId: params.id,
    });
    setSubmitting(false);
    setState({ status: "declined" });
  }

  return (
    <AuthShell
      title="Organization invitation"
      description="Review and respond to this invitation."
      footer={
        <p className="text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      {state.status === "loading" ? (
        <div className="flex justify-center">
          <Spinner />
        </div>
      ) : state.status === "unauthenticated" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {signUpEnabled
              ? "Sign in or create an account to view and respond to this invitation."
              : "Sign in to view and respond to this invitation. If you're new, check your email for a link to set up your account."}
          </p>
          <div className="flex gap-2">
            <Button
              nativeButton={false}
              render={
                <Link
                  href={`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`}
                >
                  Sign in
                </Link>
              }
            />
            {signUpEnabled ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/sign-up?redirectTo=${encodeURIComponent(redirectTo)}`}
                  >
                    Create account
                  </Link>
                }
              />
            ) : null}
          </div>
        </div>
      ) : state.status === "error" ? (
        <p className="text-sm text-muted-foreground">{state.message}</p>
      ) : state.status === "accepted" ? (
        <p className="text-sm text-muted-foreground">
          Invitation accepted. Redirecting you to the app…
        </p>
      ) : state.status === "declined" ? (
        <p className="text-sm text-muted-foreground">
          You&apos;ve declined this invitation.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to join{" "}
            <strong>{state.organizationName}</strong>. If you weren&apos;t
            expecting this, you can decline it below.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleAccept} disabled={submitting}>
              {submitting ? <Spinner /> : null}
              Accept
            </Button>
            <Button
              variant="outline"
              onClick={handleDecline}
              disabled={submitting}
            >
              Decline
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
