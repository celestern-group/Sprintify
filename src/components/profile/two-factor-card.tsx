"use client";

import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react";
import { useState } from "react";
import QRCode from "react-qr-code";
import { Spinner } from "@/components/kibo-ui/spinner";
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
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

type View =
  | "resting"
  | "enable-password"
  | "enable-verify"
  | "show-backup"
  | "regenerate-password"
  | "disable-password";

function BackupCodes({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[];
  onDone: () => void;
  doneLabel: string;
}) {
  async function copy() {
    await navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Backup codes copied.");
  }

  function download() {
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sprintify-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <CardContent className="flex flex-col gap-4 pt-6">
        <p className="text-sm text-muted-foreground">
          Save these backup codes somewhere safe. Each can be used once to sign
          in if you lose access to your authenticator app. They won&apos;t be
          shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-chip p-4 font-mono text-sm tabular-nums">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            <IconCopy />
            Copy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <IconDownload />
            Download
          </Button>
        </div>
      </CardContent>
      <CardFooter className="justify-end border-t [.border-t]:pt-6">
        <Button onClick={onDone}>{doneLabel}</Button>
      </CardFooter>
    </>
  );
}

export function TwoFactorCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [view, setView] = useState<View>("resting");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reset(next: View = "resting") {
    setPassword("");
    setCode("");
    setError(null);
    setView(next);
  }

  async function startEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error: enableError } = await authClient.twoFactor.enable({
      password,
    });
    setLoading(false);

    if (enableError || !data) {
      setError(enableError?.message ?? "Incorrect password.");
      return;
    }

    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
    setCode("");
    setView("enable-verify");
  }

  async function verifyEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });
    setLoading(false);

    if (verifyError) {
      setError(verifyError.message ?? "Invalid code. Please try again.");
      return;
    }

    setEnabled(true);
    setCode("");
    setView("show-backup");
    toast.success("Two-factor authentication enabled.");
  }

  async function regenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error: genError } =
      await authClient.twoFactor.generateBackupCodes({ password });
    setLoading(false);

    if (genError || !data) {
      setError(genError?.message ?? "Incorrect password.");
      return;
    }

    setBackupCodes(data.backupCodes);
    setPassword("");
    setView("show-backup");
    toast.success("New backup codes generated.");
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const { error: disableError } = await authClient.twoFactor.disable({
      password,
    });
    setLoading(false);

    if (disableError) {
      setError(disableError.message ?? "Incorrect password.");
      return;
    }

    setEnabled(false);
    reset("resting");
    toast.success("Two-factor authentication disabled.");
  }

  // --- Enrollment: password step ---
  if (view === "enable-password") {
    return (
      <Card>
        <form onSubmit={startEnable} noValidate>
          <CardHeader className="border-b [.border-b]:pb-6">
            <CardTitle>Enable two-factor authentication</CardTitle>
            <CardDescription>
              Confirm your password to begin setup.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tfa-password">Password</FieldLabel>
                <Input
                  id="tfa-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t [.border-t]:pt-6">
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !password}>
              {loading ? <Spinner /> : null}
              Continue
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  // --- Enrollment: scan QR + verify ---
  if (view === "enable-verify") {
    return (
      <Card>
        <form onSubmit={verifyEnable} noValidate>
          <CardHeader className="border-b [.border-b]:pb-6">
            <CardTitle>Scan the QR code</CardTitle>
            <CardDescription>
              Scan this with your authenticator app, then enter the 6-digit code
              it shows.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-5 pt-6">
            {/* QR quiet zone stays white in both themes — scanners need a light quiet zone, so this must not be themed. */}
            <div className="rounded-lg bg-white p-4">
              <QRCode value={totpUri} size={160} />
            </div>
            <FieldGroup className="w-full">
              <Field>
                <FieldLabel htmlFor="tfa-verify-code">
                  Verification code
                </FieldLabel>
                <InputOTP
                  id="tfa-verify-code"
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  containerClassName="justify-center"
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t [.border-t]:pt-6">
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || code.length < 6}>
              {loading ? <Spinner /> : null}
              Verify & activate
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  // --- Show backup codes (after enable or regenerate) ---
  if (view === "show-backup") {
    return (
      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Save your backup codes</CardTitle>
          <CardDescription>
            Store these in a safe place before continuing.
          </CardDescription>
        </CardHeader>
        <BackupCodes
          codes={backupCodes}
          onDone={() => {
            setBackupCodes([]);
            reset("resting");
          }}
          doneLabel="I've saved them"
        />
      </Card>
    );
  }

  // --- Password step for regenerate / disable ---
  if (view === "regenerate-password" || view === "disable-password") {
    const isDisable = view === "disable-password";
    return (
      <Card>
        <form onSubmit={isDisable ? disable : regenerate} noValidate>
          <CardHeader className="border-b [.border-b]:pb-6">
            <CardTitle>
              {isDisable
                ? "Disable two-factor authentication"
                : "Regenerate backup codes"}
            </CardTitle>
            <CardDescription>
              {isDisable
                ? "Confirm your password. This removes the second factor from your account."
                : "Confirm your password. Your existing backup codes will stop working."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tfa-confirm-password">Password</FieldLabel>
                <Input
                  id="tfa-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t [.border-t]:pt-6">
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={isDisable ? "destructive" : "default"}
              disabled={loading || !password}
            >
              {loading ? <Spinner /> : null}
              {isDisable ? "Disable" : "Regenerate"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  // --- Resting state ---
  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          Add a second step at sign-in using an authenticator app.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {enabled ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <IconCheck className="size-4" />
            Two-factor authentication is on.
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Two-factor authentication is off. Turn it on to better protect your
            account.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t [.border-t]:pt-6">
        {enabled ? (
          <>
            <Button
              variant="outline"
              onClick={() => reset("regenerate-password")}
            >
              Regenerate backup codes
            </Button>
            <Button
              variant="destructive"
              onClick={() => reset("disable-password")}
            >
              Disable
            </Button>
          </>
        ) : (
          <Button onClick={() => reset("enable-password")}>
            Enable two-factor authentication
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
