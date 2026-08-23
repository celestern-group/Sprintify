"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { trackEvent } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

export function SignInForm({
  signUpEnabled,
  requestAccessEnabled,
}: {
  signUpEnabled: boolean;
  requestAccessEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams.get("redirectTo");
  const redirectTo =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [ssoSlug, setSsoSlug] = useState("");
  const [showSsoField, setShowSsoField] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendState("idle");
    setLoading(true);

    const { data, error: signInError } = await authClient.signIn.email({
      email,
      password,
      fetchOptions: {
        headers: { "x-captcha-response": captchaToken ?? "" },
      },
    });

    setLoading(false);

    if (signInError) {
      trackEvent("auth.sign_in", { success: false });
      if (signInError.status === 403) {
        setNeedsVerification(true);
        setError("Please verify your email address before signing in.");
      } else {
        setError(signInError.message ?? "Unable to sign in. Please try again.");
      }
      return;
    }

    trackEvent("auth.sign_in", { success: true });

    // 2FA-enabled accounts aren't signed in yet — the second factor must be
    // verified first. Carry the intended destination through the challenge.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push(`/two-factor?redirectTo=${encodeURIComponent(redirectTo)}`);
      return;
    }

    router.push(redirectTo);
  }

  async function handleResendVerification() {
    trackEvent("auth.resend_verification");
    setResendState("sending");
    await authClient.sendVerificationEmail({
      email,
      callbackURL: "/sign-in",
    });
    setResendState("sent");
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your account to continue."
      footer={
        <div className="flex flex-col items-center gap-2">
          {signUpEnabled ? (
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href={
                  requestedRedirect
                    ? `/sign-up?redirectTo=${encodeURIComponent(redirectTo)}`
                    : "/sign-up"
                }
                className="font-semibold text-brand underline-offset-4 hover:underline"
              >
                Sign up
              </Link>
            </p>
          ) : requestAccessEnabled ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/sign-up">Request access</Link>}
            />
          ) : null}
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
        </div>
      }
    >
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
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          {needsVerification ? (
            <Field>
              <Button
                type="button"
                variant="outline"
                disabled={resendState !== "idle"}
                onClick={handleResendVerification}
              >
                {resendState === "sending" ? <Spinner /> : null}
                {resendState === "sent"
                  ? "Verification email sent"
                  : "Resend verification email"}
              </Button>
            </Field>
          ) : null}
          <Field>
            <TurnstileWidget onVerify={setCaptchaToken} />
          </Field>
          <Field>
            <Button type="submit" disabled={loading || !captchaToken}>
              {loading ? <Spinner /> : null}
              Sign in
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <FieldSeparator className="my-5" />

      {showSsoField ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ssoSlug.trim()) return;
            trackEvent("auth.sign_in", { mode: "sso", slug: ssoSlug.trim() });
            router.push(`/sign-in/${encodeURIComponent(ssoSlug.trim())}`);
          }}
          noValidate
        >
          <Field orientation="responsive">
            <Input
              autoFocus
              placeholder="your-company or your-company.com"
              aria-label="Organization slug or domain"
              value={ssoSlug}
              onChange={(event) => setSsoSlug(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!ssoSlug.trim()}>
              Continue
            </Button>
          </Field>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            trackEvent("ui.shortcut_press", { action: "toggle_sso_field" });
            setShowSsoField(true);
          }}
        >
          Sign in with your company&apos;s SSO
        </Button>
      )}
    </AuthShell>
  );
}
