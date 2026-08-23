"use client";

import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { WorkItemTypeIcon } from "@/components/app/backlog/work-item-visuals";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { WorkItemTypeRow } from "@/lib/actions/work-items";
import {
  fieldsForType,
  type WorkItemFieldDefinition,
} from "@/lib/work-item-fields";

/**
 * The inline composer a board column opens from its `+`: a title, a type, and
 * nothing else. Everything the item form asks for is optional at create time
 * (`createWorkItemSchema` needs only a project, a type and a summary), so
 * capturing a story mid-conversation shouldn't cost a page navigation — the
 * card lands in this column and gets filled in later.
 *
 * It stays open after a successful create and refocuses the box, because the
 * moment you use this in is a planning session where five stories arrive in a
 * row, not one.
 *
 * ESCAPE HATCH: custom fields marked required are enforced server-side by
 * `persistFieldValues`, and this composer has nowhere to put them — so when the
 * chosen type carries one, quick-add steps aside and points at the full form
 * with the title already typed in carried over, rather than letting the create
 * fail on submit.
 *
 * KEYBOARD: Enter creates, Shift+Enter is a newline, Escape closes. The
 * buttons do the same things for anyone not driving from the keyboard.
 */
export function QuickAddCard({
  statusId,
  statusName,
  types,
  fields,
  fullFormHref,
  onCreate,
  onClose,
}: {
  statusId: string;
  statusName: string;
  types: WorkItemTypeRow[];
  /** The org's custom field catalog — read only to spot required ones. */
  fields: WorkItemFieldDefinition[];
  /** `${basePath}/backlog/new` — the status, type and title are appended. */
  fullFormHref: string;
  /** Resolves true when the item was created, false when the server refused. */
  onCreate: (input: {
    statusId: string;
    typeId: string;
    summary: string;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const defaultTypeId =
    types.find((type) => type.isDefault)?.id ?? types[0]?.id ?? "";
  const [typeId, setTypeId] = useState(defaultTypeId);
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Opening the composer is the whole interaction — land the caret in it.
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const type = types.find((row) => row.id === typeId) ?? types[0];
  const required = fieldsForType(fields, typeId).filter(
    (field) => field.isRequired,
  );
  const trimmed = summary.trim();
  const blocked = required.length > 0;

  const handoff = (() => {
    const params = new URLSearchParams({ status: statusId });
    if (typeId) params.set("type", typeId);
    if (trimmed) params.set("summary", trimmed);
    return `${fullFormHref}?${params.toString()}`;
  })();

  async function submit() {
    if (!trimmed || !typeId || pending || blocked) return;
    setPending(true);
    let created = false;
    try {
      created = await onCreate({ statusId, typeId, summary: trimmed });
    } finally {
      setPending(false);
    }
    if (!created) return;
    setSummary("");
    boxRef.current?.focus();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2 shadow-card">
      <label className="sr-only" htmlFor={`quick-add-${statusId}`}>
        Title of the new item in {statusName}
      </label>
      <Textarea
        id={`quick-add-${statusId}`}
        ref={boxRef}
        value={summary}
        maxLength={300}
        disabled={pending}
        placeholder="What needs doing?"
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        // Reads as the card's own title line rather than a form field — but
        // the focus ring stays: it is the only thing that says where the caret
        // is on a keyboard-driven pass.
        className="min-h-14 bg-transparent px-1 py-1 text-sm font-semibold leading-snug"
      />

      {blocked ? (
        // Named, not silent: the create would have failed on the server with
        // the same field names, one round trip later.
        <p className="px-1 pb-2 text-[11px] text-warning">
          {required.map((field) => field.label).join(", ")}{" "}
          {required.length === 1 ? "is" : "are"} required on{" "}
          {type?.name ?? "this type"} — finish it on the full form.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <NativeSelect
          size="sm"
          value={typeId}
          disabled={pending}
          aria-label="Type of the new item"
          onChange={(event) => setTypeId(event.target.value)}
          className="w-auto min-w-0 flex-1"
        >
          {types.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
        {type ? <WorkItemTypeIcon type={type} /> : null}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {blocked ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={handoff} />}
          >
            Full form
            <IconArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={pending || trimmed.length === 0}
          >
            {pending ? <Spinner className="size-4" /> : null}
            Add
          </Button>
        )}
      </div>

      {blocked ? null : (
        <p className="px-1 pt-2 text-[11px] text-muted-foreground">
          Enter to add ·{" "}
          <Link href={handoff} className="font-semibold text-brand">
            add details
          </Link>
        </p>
      )}
    </div>
  );
}
