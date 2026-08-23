"use client";

import { IconSparkles } from "@tabler/icons-react";
import { useState, useTransition } from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { assistFieldText } from "@/lib/actions/ai-assist";
import {
  AI_TEXT_OPERATION_HINTS,
  AI_TEXT_OPERATION_LABELS,
  AI_TEXT_OPERATIONS,
  type AiTextOperation,
  needsInstruction,
} from "@/lib/ai/assist-operations";

/**
 * The AI control that sits beside a prose field's label.
 *
 * Nothing it produces is ever written straight into the field: the result lands
 * in a preview the author accepts, appends or throws away. A rewrite that
 * silently replaced what someone typed would be the one bug nobody forgives —
 * and "append" exists because the honest answer to a suggestion is often
 * "some of that".
 */
export function AiAssistMenu({
  projectId,
  workItemId,
  fieldLabel,
  value,
  disabled,
  context,
  runAssist,
  targetNoun,
  onApply,
}: {
  /** Required unless `runAssist` is supplied — only the default action uses it. */
  projectId?: string;
  workItemId?: string | null;
  /** Names the field in the prompt — a custom field passes its own label. */
  fieldLabel: string;
  /** Current markdown. */
  value: string;
  disabled?: boolean;
  /** What the item is right now, for a form that hasn't been saved yet. */
  context?: { summary?: string; typeName?: string };
  /**
   * The action that does the rewriting. Defaults to `assistFieldText`, which
   * is gated on item:update — right for a prose FIELD, wrong for a comment
   * draft, where the permission that matters is comment:create. Injected
   * rather than branched on a `surface` prop so the menu never has to know
   * which permission any given caller runs under.
   */
  runAssist?: (input: {
    operation: AiTextOperation;
    text: string;
    instruction: string | null;
  }) => Promise<{ ok: true; text: string } | { ok: false; message: string }>;
  /** Labels the apply toast — "Field replaced." doesn't fit a comment box. */
  targetNoun?: string;
  onApply: (markdown: string, mode: "replace" | "append") => void;
}) {
  const [pending, startTransition] = useTransition();
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const empty = value.trim().length === 0;

  function run(operation: AiTextOperation, customInstruction?: string) {
    startTransition(async () => {
      try {
        const response = runAssist
          ? await runAssist({
              operation,
              text: value,
              instruction: customInstruction ?? null,
            })
          : await assistFieldText({
              projectId: projectId ?? "",
              workItemId,
              fieldLabel,
              operation,
              text: value,
              instruction: customInstruction ?? null,
              context,
            });
        if (!response.ok) {
          toast.error(response.message);
          return;
        }
        setAsking(false);
        setResult(response.text);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "The rewrite failed.",
        );
      }
    });
  }

  function choose(operation: AiTextOperation) {
    if (needsInstruction(operation)) {
      setInstruction("");
      setAsking(true);
      return;
    }
    run(operation);
  }

  function apply(mode: "replace" | "append") {
    if (!result) return;
    onApply(result, mode);
    setResult(null);
    toast.success(
      mode === "replace"
        ? `${targetNoun ?? "Field"} replaced.`
        : "Suggestion added.",
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="h-7 gap-1.5 px-2 text-brand"
              // An empty field is not a reason to switch the control off — it
              // is the case where "write this for me" is worth the most.
              disabled={disabled || pending}
              size="sm"
              type="button"
              variant="ghost"
            >
              {pending ? (
                <Spinner className="size-3.5" />
              ) : (
                <IconSparkles className="size-3.5" />
              )}
              <span className="text-[11px] font-bold uppercase tracking-[0.09em]">
                AI
              </span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          {/* The group is required, not decorative: Base UI's GroupLabel reads
              its context from it and throws without one. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {empty ? "Write" : "Rewrite"} {fieldLabel.toLowerCase()}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {AI_TEXT_OPERATIONS.map((operation) => (
              <DropdownMenuItem
                key={operation}
                // Everything except the custom instruction edits text that has
                // to exist first — offered but inert on a blank field, rather
                // than hidden, so the menu doesn't change shape as you type.
                disabled={empty && operation !== "custom"}
                onClick={() => choose(operation)}
                // Two lines: the hint is what stops "Restructure" and "Improve
                // writing" from looking like the same button.
                className="flex-col items-start gap-0.5"
              >
                <span>
                  {empty && operation === "custom"
                    ? "Write it for me…"
                    : AI_TEXT_OPERATION_LABELS[operation]}
                </span>
                <span className="text-muted-foreground text-xs">
                  {empty && operation === "custom"
                    ? "Say what it should cover."
                    : AI_TEXT_OPERATION_HINTS[operation]}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setAsking} open={asking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {empty ? "What should it say?" : "What should change?"}
            </DialogTitle>
            <DialogDescription>
              {empty
                ? `${fieldLabel} is empty — this writes it from the item's name and type.`
                : `An editing instruction for ${fieldLabel.toLowerCase()} — the field's own text is what gets rewritten.`}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ai-instruction">Instruction</FieldLabel>
            <Textarea
              id="ai-instruction"
              maxLength={500}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={
                empty
                  ? "Cover the happy path and what happens when the quota is already spent."
                  : "Make it more technical and split the second paragraph into steps."
              }
              rows={3}
              value={instruction}
            />
            <FieldDescription>
              {empty
                ? "It only uses what the item already says — it won't invent specifics."
                : "Describe the edit, not the content — this rewrites what's already there."}
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button onClick={() => setAsking(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={pending || instruction.trim().length === 0}
              onClick={() => run("custom", instruction.trim())}
            >
              {pending ? <Spinner className="size-4" /> : null}
              Rewrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setResult(null)} open={!!result}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Suggested {fieldLabel.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Nothing is saved until you accept it — and nothing is written to
              the item until you save the form.
            </DialogDescription>
          </DialogHeader>
          {/* min-w-0 + whitespace-pre-wrap: model output carries long URLs and
              code, and this dialog must not widen around them. */}
          <div className="max-h-[50vh] min-w-0 overflow-y-auto rounded-[11px] border border-border bg-muted p-3">
            <pre className="min-w-0 whitespace-pre-wrap wrap-break-word font-sans text-sm leading-relaxed">
              {result}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setResult(null)} variant="outline">
              Discard
            </Button>
            <Button onClick={() => apply("append")} variant="outline">
              Add below
            </Button>
            <Button onClick={() => apply("replace")}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
