"use client";

import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { addOrganizationMemberDirectly } from "@/lib/actions/org-members";

export function AddMemberForm({
  organizationId,
  onAdded,
}: {
  organizationId: string;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const result = await addOrganizationMemberDirectly({
        organizationId,
        email,
        name: name.trim() || undefined,
        role: role as "member" | "admin",
      });

      if (result.accountCreated) {
        toast.success(
          result.notificationEmailSent
            ? `${result.email} was added. We emailed them a link to set a password — it expires in an hour, use "Resend link" if they miss it.`
            : `${result.email} was added, but the set-password email failed to send. Use "Resend link" in the roster below.`,
        );
      } else {
        toast.success(
          result.notificationEmailSent
            ? `${result.email} was added to the organization and notified by email.`
            : `${result.email} was added, but we couldn't email them about it.`,
        );
      }

      if (result.invitationsSuperseded > 0) {
        toast.info(
          `Cancelled ${result.invitationsSuperseded} pending invitation${
            result.invitationsSuperseded === 1 ? "" : "s"
          } for that address — they're a member now.`,
        );
      }

      setEmail("");
      setName("");
      onAdded();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add this member.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="add-member-email">Email</FieldLabel>
          <Input
            id="add-member-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="add-member-name">Name (optional)</FieldLabel>
          <Input
            id="add-member-name"
            autoComplete="off"
            aria-describedby="add-member-name-hint"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription id="add-member-name-hint">
            Only used if we have to create the account — an existing user keeps
            the name on their profile.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="add-member-role">Role</FieldLabel>
            <NativeSelect
              id="add-member-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <NativeSelectOption value="member">member</NativeSelectOption>
              <NativeSelectOption value="admin">admin</NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={loading || !email}>
          {loading ? <Spinner /> : null}
          Add member
        </Button>
      </div>
    </form>
  );
}
