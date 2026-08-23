import { Button, Link, Text } from "react-email";
import { button, EmailLayout, link, text } from "./components/email-layout";

// Sent when an org admin adds an *existing* platform account straight into an
// organization (src/lib/actions/org-members.ts). There is nothing to accept and
// no password to set — this exists purely so nobody silently gains a membership
// they were never told about. Accounts provisioned by the same action get the
// set-password mail (ResetPasswordEmail with `isInvite`) instead, which already
// names the org, so they never receive both.
export function OrganizationMemberAddedEmail({
  userName,
  adderName,
  organizationName,
  roleLabel,
  organizationUrl,
}: {
  userName?: string | null;
  adderName: string;
  organizationName: string;
  roleLabel: string;
  organizationUrl: string;
}) {
  return (
    <EmailLayout
      preview={`You've been added to ${organizationName}`}
      heading="You've been added to a team"
    >
      <Text style={text}>Hi {userName || "there"},</Text>
      <Text style={text}>
        <strong>{adderName}</strong> added you to{" "}
        <strong>{organizationName}</strong> as a {roleLabel}. It's already on
        your account — sign in with your existing password and you'll find it in
        your organization switcher.
      </Text>
      <Button href={organizationUrl} style={button}>
        Go to {organizationName}
      </Button>
      <Text style={text}>
        Or copy and paste this link into your browser:
        <br />
        <Link href={organizationUrl} style={link}>
          {organizationUrl}
        </Link>
      </Text>
      <Text style={text}>
        If you weren&apos;t expecting this, you can leave the organization from
        its members page.
      </Text>
    </EmailLayout>
  );
}

export default function OrganizationMemberAddedEmailPreview() {
  return (
    <OrganizationMemberAddedEmail
      userName="Jamie"
      adderName="Ada Lovelace"
      organizationName="Acme Corp"
      roleLabel="member"
      organizationUrl="https://sprintify.app/app/acme-corp"
    />
  );
}
