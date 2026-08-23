"use client";

import { useEffect, useState } from "react";
import { type PickedUser, UserPicker } from "@/components/admin/user-picker";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  createOrganization,
  updateOrganization,
} from "@/lib/actions/admin-organizations";

export type OrganizationFormRow = {
  id: string;
  name: string;
  slug: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function OrganizationFormDialog({
  mode,
  organization,
  open,
  onOpenChange,
  onDone,
}: {
  mode: "create" | "edit";
  organization?: OrganizationFormRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(organization?.name ?? "");
    setSlug(organization?.slug ?? "");
    setSlugEdited(mode === "edit");
    setOwner(null);
  }, [open, organization, mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "edit" && organization) {
        await updateOrganization(organization.id, { name, slug });
        toast.success(`${name} updated.`);
      } else {
        if (!owner) throw new Error("Select an owner.");
        await createOrganization({
          name,
          slug,
          ownerUserId: owner.id,
        });
        toast.success(`${name} created.`);
      }
      onOpenChange(false);
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save organization.",
      );
    }
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit organization" : "Create organization"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                required
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugEdited) setSlug(slugify(value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
              <Input
                id="org-slug"
                required
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(slugify(event.target.value));
                }}
              />
            </Field>
            {mode === "create" ? (
              <Field>
                <FieldLabel htmlFor="org-owner">Owner</FieldLabel>
                <UserPicker
                  id="org-owner"
                  value={owner}
                  onValueChange={setOwner}
                />
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              type="submit"
              disabled={
                loading || !name || !slug || (mode === "create" && !owner)
              }
            >
              {loading ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
