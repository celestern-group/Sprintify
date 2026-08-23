"use client";

import {
  IconBulb,
  IconPencil,
  IconSparkles,
  IconWand,
} from "@tabler/icons-react";
import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convertIdea,
  createIdea,
  evaluateIdea,
  suggestIdeaWork,
  updateIdea,
} from "@/lib/actions/ideas";

type Idea = {
  id: string;
  title: string;
  description: string;
  status: "open" | "reviewing" | "converted" | "declined";
  createdAt: Date;
  authorName: string | null;
  evaluations: Array<{
    impact: number;
    effort: number;
    note: string | null;
    name: string | null;
  }>;
  workItems: Array<{ id: string; summary: string; number: number }>;
};

export function IdeaManager({
  projectId,
  basePath,
  projectKey,
  ideas,
  types,
  canCreate,
  canUpdate,
}: {
  projectId: string;
  basePath: string;
  projectKey: string;
  ideas: Idea[];
  types: Array<{ id: string; name: string }>;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const share = () =>
    startTransition(async () => {
      try {
        await createIdea({ projectId, title, description });
        setTitle("");
        setDescription("");
        toast.success("Idea shared with the project.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't share the idea.",
        );
      }
    });
  return (
    <div className="flex flex-col gap-6">
      {canCreate ? (
        <Card className="border-primary/20 bg-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-md bg-secondary text-secondary-foreground">
                <IconBulb className="size-5" />
              </span>
              <div>
                <CardTitle>Share an idea</CardTitle>
                <CardDescription>
                  Everyone on this project can evaluate it before it becomes
                  planned work.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What opportunity should we explore?"
              maxLength={300}
            />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the problem, audience, and desired outcome."
              maxLength={20_000}
            />
            <div className="flex justify-end">
              <Button
                disabled={
                  pending ||
                  title.trim().length < 3 ||
                  description.trim().length < 3
                }
                onClick={share}
              >
                <IconBulb />
                Share idea
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {ideas.length ? (
        <div className="grid gap-4">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              projectId={projectId}
              basePath={basePath}
              projectKey={projectKey}
              idea={idea}
              types={types}
              canCreate={canCreate}
              canUpdate={canUpdate}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <IconBulb className="mx-auto size-8 text-brand" />
            <p className="mt-3 font-semibold">No ideas shared yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Capture an opportunity here before it becomes backlog work.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IdeaCard({
  projectId,
  basePath,
  projectKey,
  idea,
  types,
  canCreate,
  canUpdate,
}: {
  projectId: string;
  basePath: string;
  projectKey: string;
  idea: Idea;
  types: Array<{ id: string; name: string }>;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const [impact, setImpact] = useState("3");
  const [effort, setEffort] = useState("3");
  const [note, setNote] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ summary: string; description: string }>
  >([]);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(idea.title);
  const [editDescription, setEditDescription] = useState(idea.description);
  const [pending, startTransition] = useTransition();
  const average = (field: "impact" | "effort") =>
    idea.evaluations.length
      ? (
          idea.evaluations.reduce(
            (sum, evaluation) => sum + evaluation[field],
            0,
          ) / idea.evaluations.length
        ).toFixed(1)
      : "—";
  const evaluate = () =>
    startTransition(async () => {
      try {
        await evaluateIdea({
          projectId,
          ideaId: idea.id,
          impact: Number(impact),
          effort: Number(effort),
          note,
        });
        setNote("");
        toast.success("Evaluation saved.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't save evaluation.",
        );
      }
    });
  const suggest = () =>
    startTransition(async () => {
      try {
        const result = await suggestIdeaWork({ projectId, ideaId: idea.id });
        if ("message" in result) toast.error(result.message);
        else setSuggestions(result.items);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "AI couldn't create a plan.",
        );
      }
    });
  const convert = () =>
    startTransition(async () => {
      try {
        const made = await convertIdea({
          projectId,
          ideaId: idea.id,
          typeId,
          items: suggestions.length
            ? suggestions
            : [{ summary: idea.title, description: idea.description }],
        });
        setSuggestions([]);
        toast.success(
          `${made.length} work item${made.length === 1 ? "" : "s"} created.`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't create work items.",
        );
      }
    });
  const saveEdit = () =>
    startTransition(async () => {
      try {
        await updateIdea({
          projectId,
          ideaId: idea.id,
          title: editTitle,
          description: editDescription,
        });
        setEditing(false);
        toast.success("Idea updated.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't update the idea.",
        );
      }
    });
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={idea.status === "converted" ? "success" : "info"}>
                {idea.status === "converted"
                  ? "Converted"
                  : "Open for evaluation"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Shared by {idea.authorName ?? "a former member"}
              </span>
            </div>
            <CardTitle>
              <Link
                href={`${basePath}/ideas/${idea.id}`}
                className="hover:text-brand hover:underline"
              >
                {idea.title}
              </Link>
            </CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
            <span>
              Impact{" "}
              <strong className="text-foreground">{average("impact")}</strong>
            </span>
            <span>
              Effort{" "}
              <strong className="text-foreground">{average("effort")}</strong>
            </span>
            {canUpdate && idea.status !== "converted" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <IconPencil />
                Edit
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {idea.description}
        </p>
        {idea.workItems.length ? (
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="font-semibold">Created work: </span>
            {idea.workItems.map((item, index) => (
              <Fragment key={item.id}>
                {index ? ", " : null}
                <a
                  href={`${basePath}/backlog/${projectKey}-${item.number}`}
                  className="text-brand hover:underline"
                >
                  {item.summary}
                </a>
              </Fragment>
            ))}
          </div>
        ) : null}
        {idea.status !== "converted" ? (
          <div className="grid gap-3 border-t border-border pt-4 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
              <label className="text-xs font-semibold">
                Impact
                <select
                  aria-label="Impact"
                  value={impact}
                  onChange={(event) => setImpact(event.target.value)}
                  className="ml-2 rounded-md bg-muted px-2 py-1 text-sm"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
              <label className="text-xs font-semibold">
                Effort
                <select
                  aria-label="Effort"
                  value={effort}
                  onChange={(event) => setEffort(event.target.value)}
                  className="ml-2 rounded-md bg-muted px-2 py-1 text-sm"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional evaluation note"
                maxLength={1000}
              />
            </div>
            <Button variant="outline" disabled={pending} onClick={evaluate}>
              Save evaluation
            </Button>
          </div>
        ) : null}
        {canCreate && idea.status !== "converted" ? (
          <div className="rounded-lg border border-primary/20 bg-secondary/35 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  Turn insight into a work plan
                </p>
                <p className="text-xs text-muted-foreground">
                  AI suggests a small set of independently deliverable work
                  items for your review.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" disabled={pending} onClick={suggest}>
                  <IconSparkles />
                  AI plan
                </Button>
                <Button disabled={pending || !typeId} onClick={convert}>
                  <IconWand />
                  Create work
                </Button>
              </div>
            </div>
            {suggestions.length ? (
              <div className="mt-3 grid gap-2">
                {suggestions.map((item, index) => (
                  <div key={item.summary} className="rounded-md bg-card p-3">
                    <p className="font-semibold">
                      {index + 1}. {item.summary}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                ))}
                <label className="mt-1 text-xs font-semibold">
                  Work item type{" "}
                  <select
                    value={typeId}
                    onChange={(event) => setTypeId(event.target.value)}
                    className="ml-2 rounded-md bg-card px-2 py-1 text-sm"
                  >
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit idea</DialogTitle>
            <DialogDescription>
              Keep the opportunity clear before turning it into planned work.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-3">
            <Input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              maxLength={300}
              aria-label="Idea title"
            />
            <Textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              maxLength={20_000}
              aria-label="Idea description"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                pending ||
                editTitle.trim().length < 3 ||
                editDescription.trim().length < 3
              }
              onClick={saveEdit}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
