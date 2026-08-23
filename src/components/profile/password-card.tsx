"use client";

import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

function ChangePasswordForm({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: changeError } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });
    setLoading(false);

    if (changeError) {
      setError(changeError.message ?? "Unable to change password.");
      return;
    }

    toast.success("Password updated.");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRevokeOtherSessions(false);
  }

  return (
    <>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Update the password used to sign in as {email}.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form id="password-form" onSubmit={submit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
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
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={mismatch}
              />
            </Field>
            <label
              htmlFor="revoke-other-sessions"
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                id="revoke-other-sessions"
                checked={revokeOtherSessions}
                onCheckedChange={(checked) =>
                  setRevokeOtherSessions(checked === true)
                }
              />
              Sign out of all other devices
            </label>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-end border-t [.border-t]:pt-6">
        <Button
          type="submit"
          form="password-form"
          disabled={
            loading ||
            !currentPassword ||
            newPassword.length < 8 ||
            confirmPassword.length < 8
          }
        >
          {loading ? <Spinner /> : null}
          Update password
        </Button>
      </CardFooter>
    </>
  );
}

function SetPasswordForm({ email }: { email: string }) {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setLoading(true);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
      fetchOptions: {
        headers: { "x-captcha-response": captchaToken ?? "" },
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? "Unable to send email.");
      return;
    }

    setSent(true);
  }

  return (
    <>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Password</CardTitle>
        <CardDescription>
          You signed up with a social provider and don&apos;t have a password
          yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-6">
        {sent ? (
          <p className="text-sm text-muted-foreground">
            We sent a link to {email} — follow it to set a password for your
            account.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Set a password so you can also sign in with your email and
              password.
            </p>
            <TurnstileWidget onVerify={setCaptchaToken} />
          </>
        )}
      </CardContent>
      {sent ? null : (
        <CardFooter className="justify-end border-t [.border-t]:pt-6">
          <Button onClick={send} disabled={loading || !captchaToken}>
            {loading ? <Spinner /> : null}
            Send set-password email
          </Button>
        </CardFooter>
      )}
    </>
  );
}

export function PasswordCard({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  return (
    <Card>
      {hasPassword ? (
        <ChangePasswordForm email={email} />
      ) : (
        <SetPasswordForm email={email} />
      )}
    </Card>
  );
}
