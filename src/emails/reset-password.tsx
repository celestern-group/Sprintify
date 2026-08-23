import { Button, Link, Text } from "react-email";
import { button, EmailLayout, link, text } from "./components/email-layout";

export function ResetPasswordEmail({
  userName,
  resetUrl,
  isInvite = false,
}: {
  userName?: string | null;
  resetUrl: string;
  isInvite?: boolean;
}) {
  return (
    <EmailLayout
      preview={
        isInvite ? "Set your password to get started" : "Reset your password"
      }
      heading={isInvite ? "Set your password" : "Reset your password"}
    >
      {isInvite ? null : <Text style={text}>Hi {userName || "there"},</Text>}
      <Text style={text}>
        {isInvite
          ? "You've been invited to join a team on Sprintify. An account has been created for you — click the button below to set your password and continue. This link is valid for 1 hour."
          : "We received a request to reset the password for your account. Click the button below to choose a new password. This link is valid for 1 hour."}
      </Text>
      <Button href={resetUrl} style={button}>
        {isInvite ? "Set password" : "Reset password"}
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={resetUrl} style={link}>
          {resetUrl}
        </Link>
      </Text>
      <Text style={text}>
        {isInvite
          ? 'If the link has already expired, ask whoever added you to send a new one — or use "Forgot password" on the sign-in page. If you weren\'t expecting this invitation, you can safely ignore this email.'
          : "If you didn't request a password reset, you can safely ignore this email — your password will not be changed."}
      </Text>
    </EmailLayout>
  );
}

export default function ResetPasswordEmailPreview() {
  return (
    <ResetPasswordEmail
      userName="Jamie"
      resetUrl="https://sprintify.app/reset-password?token=preview-token"
    />
  );
}
