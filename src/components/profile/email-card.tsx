"use client";

import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

export function EmailCard({
  initialEmail,
  initialVerified,
}: {
  initialEmail: string;
  initialVerified: boolean;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState(false);

  const dirty = newEmail.trim() !== "" && newEmail.trim() !== initialEmail;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    const { error } = await authClient.changeEmail({
      newEmail: newEmail.trim(),
      callbackURL: "/profile",
    });
    setSending(false);

    if (error) {
      toast.error(error.message ?? "Unable to change email.");
      return;
    }

    toast.success(
      `We sent a confirmation link to ${initialEmail}. Approve it to finish changing your email.`,
    );
    setNewEmail("");
  }

  async function resendVerification() {
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: initialEmail,
      callbackURL: "/profile",
    });
    setResending(false);

    if (error) {
      toast.error(error.message ?? "Unable to resend verification email.");
      return;
    }

    toast.success("Verification email sent.");
  }

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Email</CardTitle>
            <CardDescription>
              Changing your email requires confirming from your current inbox.
            </CardDescription>
          </div>
          <Badge
            variant={initialVerified ? "success" : "neutral"}
            className="mt-0.5"
          >
            {initialVerified ? "Verified" : "Unverified"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form id="email-form" onSubmit={submit} noValidate>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="current-email">Current email</FieldLabel>
              </FieldContent>
              <Input
                id="current-email"
                value={initialEmail}
                disabled
                className="sm:max-w-2xs"
              />
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="new-email">New email</FieldLabel>
                <FieldDescription>
                  We&apos;ll email a confirmation link to your current address.
                </FieldDescription>
              </FieldContent>
              <Input
                id="new-email"
                type="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                className="sm:max-w-2xs"
              />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-between border-t [.border-t]:pt-6">
        {initialVerified ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resendVerification}
            disabled={resending}
          >
            {resending ? <Spinner /> : null}
            Resend verification email
          </Button>
        )}
        <Button type="submit" form="email-form" disabled={sending || !dirty}>
          {sending ? <Spinner /> : null}
          Send confirmation
        </Button>
      </CardFooter>
    </Card>
  );
}
