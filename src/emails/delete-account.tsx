import { Button, Link, Text } from "react-email";
import {
  destructiveButton,
  EmailLayout,
  link,
  text,
} from "./components/email-layout";

export function DeleteAccountEmail({
  userName,
  deleteUrl,
}: {
  userName?: string | null;
  deleteUrl: string;
}) {
  return (
    <EmailLayout
      preview="Confirm account deletion"
      heading="Confirm account deletion"
    >
      <Text style={text}>Hi {userName || "there"},</Text>
      <Text style={text}>
        We received a request to permanently delete your account and all of its
        data. This action cannot be undone. Click the button below to confirm.
      </Text>
      <Button href={deleteUrl} style={destructiveButton}>
        Delete my account
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={deleteUrl} style={link}>
          {deleteUrl}
        </Link>
      </Text>
      <Text style={text}>
        If you didn&apos;t request this, you can safely ignore this email and
        your account will remain unchanged.
      </Text>
    </EmailLayout>
  );
}

export default function DeleteAccountEmailPreview() {
  return (
    <DeleteAccountEmail
      userName="Jamie"
      deleteUrl="https://sprintify.app/api/auth/delete-user/callback?token=preview-token"
    />
  );
}
