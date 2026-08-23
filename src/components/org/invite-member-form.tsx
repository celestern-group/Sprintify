"use client";

import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

export function InviteMemberForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const { error } = await authClient.organization.inviteMember({
      email,
      role: role as "member" | "admin" | "owner",
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? "Unable to send invitation.");
      return;
    }

    toast.success(`Invitation sent to ${email}.`);
    setEmail("");
    onInvited();
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-wrap items-end gap-2"
    >
      <FieldGroup className="flex-1">
        <Field>
          <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <NativeSelect
        value={role}
        onChange={(event) => setRole(event.target.value)}
        aria-label="Role"
      >
        <NativeSelectOption value="member">member</NativeSelectOption>
        <NativeSelectOption value="admin">admin</NativeSelectOption>
        <NativeSelectOption value="owner">owner</NativeSelectOption>
      </NativeSelect>
      <Button type="submit" disabled={loading || !email}>
        {loading ? <Spinner /> : null}
        Invite
      </Button>
    </form>
  );
}
