"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { trackEvent } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invalidToken = searchParams.get("error") === "INVALID_TOKEN";
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : null;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing or invalid reset token.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    setLoading(false);

    if (resetError) {
      trackEvent("auth.password_reset", { success: false });
      setError(
        resetError.message ?? "Unable to reset password. Please try again.",
      );
      return;
    }

    trackEvent("auth.password_reset", { success: true });
    router.push(
      next ? `/sign-in?redirectTo=${encodeURIComponent(next)}` : "/sign-in",
    );
  }

  return (
    <AuthShell
      title="Reset password"
      description="Choose a new password for your account."
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
      {invalidToken || !token ? (
        <p className="text-sm text-muted-foreground">
          This password reset link is invalid or has expired. Please request a
          new one from the{" "}
          <Link
            href="/forgot-password"
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            forgot password
          </Link>{" "}
          page.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">
                Confirm new password
              </FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Field>
              <Button type="submit" disabled={loading}>
                {loading ? <Spinner /> : null}
                Reset password
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
