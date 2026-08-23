import { Button, Link, Text } from "react-email";
import { button, EmailLayout, link, text } from "./components/email-layout";

export function ApproveEmailChangeEmail({
  userName,
  newEmail,
  approveUrl,
}: {
  userName?: string | null;
  newEmail: string;
  approveUrl: string;
}) {
  return (
    <EmailLayout
      preview="Approve your email address change"
      heading="Confirm your email change"
    >
      <Text style={text}>Hi {userName || "there"},</Text>
      <Text style={text}>
        We received a request to change the email address on your account to{" "}
        <strong>{newEmail}</strong>. Click the button below to approve this
        change.
      </Text>
      <Button href={approveUrl} style={button}>
        Approve change
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={approveUrl} style={link}>
          {approveUrl}
        </Link>
      </Text>
      <Text style={text}>
        If you didn&apos;t request this change, you can safely ignore this email
        — your email address will not be changed.
      </Text>
    </EmailLayout>
  );
}

export default function ApproveEmailChangeEmailPreview() {
  return (
    <ApproveEmailChangeEmail
      userName="Jamie"
      newEmail="jamie.new@example.com"
      approveUrl="https://sprintify.app/api/auth/verify-email?token=preview-token"
    />
  );
}
