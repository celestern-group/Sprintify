"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: createError } = await authClient.organization.create({
      name,
      slug,
    });

    if (createError || !data) {
      setLoading(false);
      setError(
        createError?.message ?? "Unable to create organization. Try again.",
      );
      return;
    }

    await authClient.organization.setActive({ organizationId: data.id });
    router.push(`/app/${data.slug}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
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
          <FieldDescription>
            Used in URLs: /app/{slug || "your-slug"}
          </FieldDescription>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <Field>
          <Button type="submit" disabled={loading || !name || !slug}>
            {loading ? <Spinner /> : null}
            Create organization
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
