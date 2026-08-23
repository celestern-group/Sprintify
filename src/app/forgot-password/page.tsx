"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Spinner } from "@/components/kibo-ui/spinner";
import { TurnstileWidget } from "@/components/turnstile-widget";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
      fetchOptions: {
        headers: { "x-captcha-response": captchaToken ?? "" },
      },
    });

    setLoading(false);

    if (requestError) {
      trackEvent("auth.forgot_password", { success: false });
      setError(
        requestError.message ?? "Unable to send reset email. Please try again.",
      );
      return;
    }

    trackEvent("auth.forgot_password", { success: true });
    setSent(true);
  }

  return (
    <AuthShell
      title="Forgot password"
      description="Enter your email and we'll send you a link to reset your password."
      footer={
        <p className="text-sm text-muted-foreground">
          Remembered your password?{" "}
          <Link
            href="/sign-in"
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <p className="text-sm text-muted-foreground">
          If an account exists for {email}, we&apos;ve sent a link to reset your
          password.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Field>
              <TurnstileWidget onVerify={setCaptchaToken} />
            </Field>
            <Field>
              <Button type="submit" disabled={loading || !captchaToken}>
                {loading ? <Spinner /> : null}
                Send reset link
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
