"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { trackEvent } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams.get("redirectTo");
  const redirectTo =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/app";

  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { error: verifyError } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code });

    setLoading(false);

    if (verifyError) {
      trackEvent("auth.sign_in", {
        success: false,
        mode: "2fa",
      });
      setError(
        verifyError.message ??
          (mode === "totp"
            ? "Invalid code. Please try again."
            : "Invalid backup code."),
      );
      return;
    }

    trackEvent("auth.sign_in", { success: true, mode: "2fa" });
    router.push(redirectTo);
  }

  function switchMode(next: "totp" | "backup") {
    setMode(next);
    setCode("");
    setError(null);
  }

  return (
    <AuthShell
      title="Two-step verification"
      description={
        mode === "totp"
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your backup codes."
      }
      footer={
        <button
          type="button"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => switchMode(mode === "totp" ? "backup" : "totp")}
        >
          {mode === "totp"
            ? "Use a backup code instead"
            : "Use your authenticator app instead"}
        </button>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          {mode === "totp" ? (
            <Field>
              <FieldLabel htmlFor="totp-code">Authentication code</FieldLabel>
              <InputOTP
                id="totp-code"
                maxLength={6}
                value={code}
                onChange={setCode}
                autoFocus
                containerClassName="justify-center"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="backup-code">Backup code</FieldLabel>
              <Input
                id="backup-code"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          )}

          {mode === "totp" ? (
            <label
              htmlFor="trust-device"
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                id="trust-device"
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(checked === true)}
              />
              Trust this device for 30 days
            </label>
          ) : null}

          {error ? <FieldError>{error}</FieldError> : null}

          <Field>
            <Button
              type="submit"
              disabled={
                loading ||
                (mode === "totp" ? code.length < 6 : code.trim().length === 0)
              }
            >
              {loading ? <Spinner /> : null}
              Verify
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
