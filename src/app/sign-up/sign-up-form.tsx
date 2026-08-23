"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
import { authClient } from "@/lib/auth-client";

export function SignUpFormWithFallback() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams.get("redirectTo");
  const redirectTo =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/app";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: redirectTo,
      fetchOptions: {
        headers: { "x-captcha-response": captchaToken ?? "" },
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Unable to sign up. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent a verification link to ${email}. Follow it to activate your account.`}
        footer={
          <p className="text-sm text-muted-foreground">
            Already verified?{" "}
            <Link
              href={
                requestedRedirect
                  ? `/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`
                  : "/sign-in"
              }
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        }
      >
        {null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      description="Get started with Sprintify in a few seconds."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
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
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
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
            <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
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
            <TurnstileWidget onVerify={setCaptchaToken} />
          </Field>
          <Field>
            <Button type="submit" disabled={loading || !captchaToken}>
              {loading ? <Spinner /> : null}
              Create account
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
