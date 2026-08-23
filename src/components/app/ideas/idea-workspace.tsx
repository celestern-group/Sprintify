"use client";

import { IconSparkles, IconWand } from "@tabler/icons-react";
import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  brainstormIdea,
  convertIdea,
  requestIdeaReviews,
  reviewIdeaPlan,
  saveIdeaPlan,
  suggestIdeaWork,
} from "@/lib/actions/ideas";
import { IdeaDiscussion } from "./idea-discussion";

type PlanItem = { summary: string; description: string };
type EditablePlanItem = PlanItem & { clientId: string };

function editablePlan(items: PlanItem[]): EditablePlanItem[] {
  return items.map((item) => ({ ...item, clientId: crypto.randomUUID() }));
}
type IdeaWorkspaceData = {
  id: string;
  title: string;
  description: string;
  status: string;
  evaluations: Array<{
    impact: number;
    effort: number;
    note: string | null;
    name: string | null;
  }>;
  reviewers: Array<{ id: string; name: string; email: string }>;
  comments: import("@/lib/actions/ideas").IdeaCommentNode[];
  plan: PlanItem[];
  workItems: Array<{ id: string; summary: string; number: number }>;
};

export function IdeaWorkspace({
  idea,
  projectId,
  types,
  members,
  canCreate,
  canComment,
  canUpdate,
}: {
  idea: IdeaWorkspaceData;
  projectId: string;
  types: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string; email: string }>;
  canCreate: boolean;
  canComment: boolean;
  canUpdate: boolean;
}) {
  const [plan, setPlan] = useState<EditablePlanItem[]>(() =>
    editablePlan(idea.plan),
  );
  const [question, setQuestion] = useState("");
  const [brainstorm, setBrainstorm] = useState("");
  const [review, setReview] = useState("");
  const [reviewers, setReviewers] = useState<string[]>(
    idea.reviewers.map((member) => member.id),
  );
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await work();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  const updatePlan = (index: number, field: keyof PlanItem, value: string) =>
    setPlan((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{idea.title}</CardTitle>
                <CardDescription className="mt-1">
                  {idea.description}
                </CardDescription>
              </div>
              <Badge variant={idea.status === "converted" ? "success" : "info"}>
                {idea.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 border-t border-border pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.09em] text-muted-foreground">
              Team evaluation
            </p>
            {idea.evaluations.length ? (
              idea.evaluations.map((evaluation) => (
                <div
                  key={`${evaluation.name}-${evaluation.impact}-${evaluation.effort}-${evaluation.note}`}
                  className="rounded-md bg-muted p-3 text-sm"
                >
                  <strong>{evaluation.name ?? "Former member"}</strong>
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    Impact {evaluation.impact}/5 · Effort {evaluation.effort}/5
                  </span>
                  {evaluation.note ? (
                    <p className="mt-1 text-muted-foreground">
                      {evaluation.note}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No evaluations yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI work plan</CardTitle>
            <CardDescription>
              Generate a draft, then edit and approve it before creating work.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!canCreate || pending}
                onClick={() =>
                  run(async () => {
                    const result = await suggestIdeaWork({
                      projectId,
                      ideaId: idea.id,
                    });
                    if ("message" in result) throw new Error(result.message);
                    setPlan(editablePlan(result.items));
                    toast.success("AI draft ready for review.");
                  })
                }
              >
                <IconSparkles />
                Create plan with AI
              </Button>
              <Button
                variant="outline"
                disabled={!canCreate || !plan.length || pending}
                onClick={() =>
                  run(async () => {
                    setReview(
                      await reviewIdeaPlan({
                        projectId,
                        ideaId: idea.id,
                        items: plan,
                      }),
                    );
                  })
                }
              >
                Review plan with AI
              </Button>
              <Button
                variant="outline"
                disabled={!canCreate || !plan.length || pending}
                onClick={() =>
                  run(async () => {
                    await saveIdeaPlan({
                      projectId,
                      ideaId: idea.id,
                      items: plan,
                    });
                    toast.success("Plan saved.");
                  })
                }
              >
                Save plan
              </Button>
            </div>
            {plan.map((item, index) => (
              <div
                key={item.clientId}
                className="grid gap-2 rounded-md border border-border p-3"
              >
                <Input
                  value={item.summary}
                  onChange={(event) =>
                    updatePlan(index, "summary", event.target.value)
                  }
                  aria-label={`Plan item ${index + 1} summary`}
                />
                <Textarea
                  value={item.description}
                  onChange={(event) =>
                    updatePlan(index, "description", event.target.value)
                  }
                  aria-label={`Plan item ${index + 1} description`}
                />
              </div>
            ))}
            {!plan.length ? (
              <p className="text-sm text-muted-foreground">
                No plan has been drafted yet.
              </p>
            ) : null}
            {review ? (
              <div className="whitespace-pre-wrap rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
                {review}
              </div>
            ) : null}
            {canCreate && idea.status !== "converted" && plan.length ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <select
                  value={typeId}
                  onChange={(event) => setTypeId(event.target.value)}
                  className="h-8 rounded-md bg-muted px-2 text-sm"
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={pending || !typeId}
                  onClick={() =>
                    run(async () => {
                      const made = await convertIdea({
                        projectId,
                        ideaId: idea.id,
                        typeId,
                        items: plan,
                      });
                      toast.success(
                        `${made.length} work item${made.length === 1 ? "" : "s"} created.`,
                      );
                    })
                  }
                >
                  <IconWand />
                  Create work items
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <IdeaDiscussion
          canComment={canComment}
          comments={idea.comments}
          ideaId={idea.id}
          members={members}
          projectId={projectId}
        />
      </div>
      <aside className="grid content-start gap-6">
        {canUpdate ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Request evaluation</CardTitle>
              <CardDescription>
                Select the teammates who should review this idea.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <select
                multiple
                value={reviewers}
                onChange={(event) =>
                  setReviewers(
                    Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
                className="min-h-28 rounded-md bg-muted p-2 text-sm"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={pending || !reviewers.length}
                onClick={() =>
                  run(async () => {
                    await requestIdeaReviews({
                      projectId,
                      ideaId: idea.id,
                      memberIds: reviewers,
                    });
                    toast.success("Reviewers notified.");
                  })
                }
              >
                Request review
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card size="sm">
          <CardHeader>
            <CardTitle>Brainstorm with AI</CardTitle>
            <CardDescription>
              AI responses are drafts for the team, not committed decisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What should we explore?"
              maxLength={500}
            />
            <Button
              variant="outline"
              disabled={pending || !question.trim()}
              onClick={() =>
                run(async () => {
                  setBrainstorm(
                    await brainstormIdea({
                      projectId,
                      ideaId: idea.id,
                      prompt: question,
                    }),
                  );
                })
              }
            >
              <IconSparkles />
              Brainstorm
            </Button>
            {brainstorm ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {brainstorm}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
