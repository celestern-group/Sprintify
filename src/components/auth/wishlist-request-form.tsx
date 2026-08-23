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
import { submitWishlistRequest } from "@/lib/actions/wishlist";

export function WishlistRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitWishlistRequest({
        name,
        email,
        captchaToken: captchaToken ?? "",
      });
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to send your request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell
        title="Request received"
        description="Thanks — a platform administrator will review your request and email you when access is ready."
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
        {null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Invite only"
      description="Request access and a platform administrator will review it."
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
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="wishlist-name">Name</FieldLabel>
            <Input
              id="wishlist-name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wishlist-email">Work email</FieldLabel>
            <Input
              id="wishlist-email"
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
            <Button type="submit" disabled={submitting || !captchaToken}>
              {submitting ? <Spinner /> : null}Request access
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
