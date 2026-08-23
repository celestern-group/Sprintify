import { Button, Link, Text } from "react-email";
import { button, EmailLayout, link, text } from "./components/email-layout";

export function OrganizationInvitationEmail({
  inviterName,
  organizationName,
  roleLabel,
  inviteUrl,
}: {
  inviterName: string;
  organizationName: string;
  roleLabel: string;
  inviteUrl: string;
}) {
  return (
    <EmailLayout
      preview={`${inviterName} invited you to join ${organizationName}`}
      heading="You've been invited"
    >
      <Text style={text}>
        <strong>{inviterName}</strong> has invited you to join{" "}
        <strong>{organizationName}</strong> as a {roleLabel}.
      </Text>
      <Button href={inviteUrl} style={button}>
        Accept invitation
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={inviteUrl} style={link}>
          {inviteUrl}
        </Link>
      </Text>
      <Text style={text}>
        If you weren&apos;t expecting this invitation, you can safely ignore
        this email.
      </Text>
    </EmailLayout>
  );
}

export default function OrganizationInvitationEmailPreview() {
  return (
    <OrganizationInvitationEmail
      inviterName="Jamie Doe"
      organizationName="Acme Corp"
      roleLabel="member"
      inviteUrl="https://sprintify.app/accept-invitation/preview-id"
    />
  );
}
