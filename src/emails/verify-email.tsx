import { Button, Link, Text } from "react-email";
import { button, EmailLayout, link, text } from "./components/email-layout";

export function VerifyEmail({
  userName,
  verifyUrl,
}: {
  userName?: string | null;
  verifyUrl: string;
}) {
  return (
    <EmailLayout
      preview="Verify your email address"
      heading="Verify your email address"
    >
      <Text style={text}>Hi {userName || "there"},</Text>
      <Text style={text}>
        Click the button below to verify your email address and finish setting
        up your account.
      </Text>
      <Button href={verifyUrl} style={button}>
        Verify email
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={verifyUrl} style={link}>
          {verifyUrl}
        </Link>
      </Text>
      <Text style={text}>
        If you didn&apos;t create an account, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}

export default function VerifyEmailPreview() {
  return (
    <VerifyEmail
      userName="Jamie"
      verifyUrl="https://sprintify.app/api/auth/verify-email?token=preview-token"
    />
  );
}
