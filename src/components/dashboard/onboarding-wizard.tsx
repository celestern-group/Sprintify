"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/lib/actions/projects";
import { authClient } from "@/lib/auth-client";

const TOTAL_STEPS = 2;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type CreatedOrg = { id: string; slug: string };

function StepLabel({ step }: { step: 1 | 2 }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
      Step {step} of {TOTAL_STEPS}
    </span>
  );
}

function OrgStep({ onCreated }: { onCreated: (org: CreatedOrg) => void }) {
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
    onCreated({ id: data.id, slug: data.slug });
  }

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <StepLabel step={1} />
        <CardTitle>Create your organization</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="onboarding-org-name">
                Organization name
              </FieldLabel>
              <Input
                id="onboarding-org-name"
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
              <FieldLabel htmlFor="onboarding-org-slug">Slug</FieldLabel>
              <Input
                id="onboarding-org-slug"
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
                Continue
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function ProjectStep({ org }: { org: CreatedOrg }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function goToDashboard() {
    router.push(`/app/${org.slug}`);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await createProject({ organizationId: org.id, name, description });
      goToDashboard();
    } catch (submitError) {
      setLoading(false);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create project. Try again.",
      );
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <StepLabel step={2} />
        <CardTitle>Create your first project</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="onboarding-project-name">Name</FieldLabel>
              <Input
                id="onboarding-project-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Marketing site redesign"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="onboarding-project-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="onboarding-project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this project is for"
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Field orientation="horizontal" className="justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={goToDashboard}
                disabled={loading}
              >
                Skip for now
              </Button>
              <Button type="submit" disabled={loading || !name}>
                {loading ? <Spinner /> : null}
                Create project
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

export function OnboardingWizard() {
  const [org, setOrg] = useState<CreatedOrg | null>(null);

  if (org) return <ProjectStep org={org} />;
  return <OrgStep onCreated={setOrg} />;
}
