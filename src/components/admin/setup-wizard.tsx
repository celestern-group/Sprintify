"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type CreatedOrg = { id: string; slug: string };
type Step = 1 | 2;

function StepLabel({ step }: { step: Step }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
      Step {step} of 2
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
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="setup-org-name">Organization name</FieldLabel>
          <Input
            id="setup-org-name"
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
          <FieldLabel htmlFor="setup-org-slug">Slug</FieldLabel>
          <Input
            id="setup-org-slug"
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
        <DialogFooter>
          <Button type="submit" disabled={loading || !name || !slug}>
            {loading ? <Spinner /> : null}
            Continue
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

function ProjectStep({
  org,
  onDone,
  onSkip,
}: {
  org: CreatedOrg;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await createProject({ organizationId: org.id, name, description });
      onDone();
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
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="setup-project-name">Name</FieldLabel>
          <Input
            id="setup-project-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Marketing site redesign"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-project-description">
            Description{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Textarea
            id="setup-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this project is for"
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={loading}
          >
            Finish without a project
          </Button>
          <Button type="submit" disabled={loading || !name}>
            {loading ? <Spinner /> : null}
            Create project
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

const STEP_COPY: Record<Step, { title: string; description: string }> = {
  1: {
    title: "Create your organization",
    description:
      "Set up the first organization to manage members and projects.",
  },
  2: {
    title: "Create your first project",
    description: "Projects hold the work your members collaborate on.",
  },
};

const DISMISSED_KEY = "sprintify:admin-setup-dismissed";
const OPEN_EVENT = "sprintify:open-admin-setup";

/** Open the admin setup wizard from anywhere in the admin chrome. */
export function openAdminSetup() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function AdminSetupWizard({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  // Start closed so SSR and the first client render agree; a dismissal is
  // persisted in localStorage so cancelling survives a browser refresh.
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [org, setOrg] = useState<CreatedOrg | null>(null);

  useEffect(() => {
    if (!needsSetup) return;
    if (localStorage.getItem(DISMISSED_KEY) === "true") return;
    setOpen(true);
  }, [needsSetup]);

  useEffect(() => {
    // Manual trigger (e.g. the "Setup" nav button) — always start fresh at
    // step 1, regardless of whether an org already exists.
    function handleOpen() {
      setOrg(null);
      setStep(1);
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  function finish() {
    setOpen(false);
    // Setup completed — clear the dismissal so a fresh admin with no orgs is
    // prompted again next time.
    localStorage.removeItem(DISMISSED_KEY);
    // Reflect the newly created org/project in the shell + admin data.
    router.refresh();
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) return;
    if (org) {
      // Closing after creating an org still needs a refresh so the chrome
      // picks it up; the org now exists, so no dismissal flag is needed.
      router.refresh();
      return;
    }
    // Cancelled before creating anything — remember it so refreshing the
    // browser doesn't re-open the wizard.
    localStorage.setItem(DISMISSED_KEY, "true");
  }

  const copy = STEP_COPY[step];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <StepLabel step={step} />
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {step === 1 ? (
          <OrgStep
            onCreated={(created) => {
              setOrg(created);
              setStep(2);
            }}
          />
        ) : null}
        {step === 2 && org ? (
          <ProjectStep org={org} onDone={finish} onSkip={finish} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
