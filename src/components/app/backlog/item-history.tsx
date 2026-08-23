import {
  UserGlimpse,
  type UserGlimpseSeed,
} from "@/components/app/user-glimpse";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  BacklogMemberRow,
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemHistoryEntry,
  WorkItemRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { formatIsoShort, todayIso } from "@/lib/date-only";
import { WORK_ITEM_ATTACHMENT_FIELD_LABELS } from "@/lib/work-item-attachments";
import { initialsOf } from "@/lib/work-items";

// What each `changes` key from the workItem.updated audit metadata is called
// on screen. Ids resolve to names through the catalogs the page already holds;
// a name that no longer resolves (deleted status, removed member) degrades to
// "(removed)" rather than leaking a raw id.
const FIELD_LABELS: Record<string, string> = {
  summary: "Summary",
  typeId: "Type",
  statusId: "Status",
  parentId: "Parent",
  sprintId: "Sprint",
  assigneeMemberId: "Assignee",
  priority: "Priority",
  points: "Estimated efforts",
  actualEfforts: "Actual efforts",
  startDate: "Start date",
  dueDate: "Due date",
  businessValue: "Business value",
  riskLevel: "Risk",
  labels: "Labels",
};

const PROSE_LABELS: Record<string, string> = {
  description: "Description",
  acceptanceCriteria: "Acceptance criteria",
  technicalNotes: "Technical notes",
  definitionOfDone: "Definition of done",
  stepsToReproduce: "Steps to reproduce",
  expectedResult: "Expected result",
  actualResult: "Actual result",
};

type Lookups = {
  statusById: Map<string, string>;
  typeById: Map<string, string>;
  sprintById: Map<string, string>;
  memberById: Map<string, string>;
  memberByEmail: Map<string, BacklogMemberRow>;
  itemById: Map<string, string>;
  unitLabel: string;
  today: string;
};

/**
 * The item's audit trail, newest first — the History tab of ItemActivity.
 * Every row is a person plus a plain sentence; `workItem.updated` entries
 * additionally list their field diffs so "updated" actually says what moved.
 *
 * Renders on the SERVER (nothing here is interactive) and is passed into the
 * client tab shell as a node, which is what keeps these catalog lookups —
 * statuses, types, sprints, every sibling item — off the client.
 */
export function ItemHistory({
  entries,
  statuses,
  types,
  sprints,
  members,
  siblings,
  capacityUnit,
}: {
  entries: WorkItemHistoryEntry[];
  statuses: WorkflowStatusRow[];
  types: WorkItemTypeRow[];
  sprints: BacklogSprintRow[];
  members: BacklogMemberRow[];
  /** Every project item (id + key), to name parent-change targets. */
  siblings: Pick<WorkItemRow, "id" | "key">[];
  capacityUnit: "hours" | "points";
}) {
  const lookups: Lookups = {
    statusById: new Map(statuses.map((row) => [row.id, row.name])),
    typeById: new Map(types.map((row) => [row.id, row.name])),
    sprintById: new Map(sprints.map((row) => [row.id, row.name])),
    memberById: new Map(members.map((row) => [row.memberId, row.name])),
    itemById: new Map(siblings.map((row) => [row.id, row.key])),
    // An audit row records the actor's NAME and EMAIL, never a member id — it
    // has to survive the person leaving. Email is the only stable handle back
    // to a current member, so the hover card is keyed on it; an ex-member
    // simply misses and gets the name-only card.
    memberByEmail: new Map(
      members.map((row) => [row.email.toLowerCase(), row]),
    ),
    unitLabel: capacityUnit === "points" ? "points" : "hours",
    today: todayIso(),
  };

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recorded history for this item yet. Changes made from now on will
          appear here.
        </p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              lookups={lookups}
              isLast={index === entries.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryRow({
  entry,
  lookups,
  isLast,
}: {
  entry: WorkItemHistoryEntry;
  lookups: Lookups;
  isLast: boolean;
}) {
  const actor = entry.actorName ?? entry.actorEmail ?? "System";
  const { phrase, lines } = describe(entry, lookups);

  const actorMember = entry.actorEmail
    ? (lookups.memberByEmail.get(entry.actorEmail.toLowerCase()) ?? null)
    : null;
  // "System" is the platform acting on its own — an automation, a cascade —
  // and there is no person behind it to preview.
  const seed =
    entry.actorName || entry.actorEmail
      ? {
          memberId: actorMember?.memberId ?? null,
          name: actor,
          email: entry.actorEmail,
          image: actorMember?.image ?? null,
        }
      : null;

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        {/* The avatar used to be initials-only — the audit row has no image, so
            nothing here ever showed one. It comes from the member the actor's
            email resolves to; an ex-member still falls back to initials. */}
        <HistoryAvatar
          actor={actor}
          image={actorMember?.image ?? null}
          seed={seed}
        />
        {isLast ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>

      <div
        className={`flex min-w-0 flex-1 flex-col gap-1 ${isLast ? "" : "pb-4"}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 text-sm">
            {seed ? (
              <UserGlimpse className="font-semibold" seed={seed}>
                {actor}
              </UserGlimpse>
            ) : (
              <span className="font-semibold">{actor}</span>
            )}{" "}
            <span className="text-muted-foreground">{phrase}</span>
          </p>
          <time
            dateTime={entry.createdAt.toISOString()}
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {formatTime(entry.createdAt)}
          </time>
        </div>
        {lines.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {lines.map((line) => (
              <li key={line.key} className="min-w-0 truncate" title={line.text}>
                {line.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The actor's face on the timeline rail. Hover-only (never a tab stop): the
 * name beside it is already a focusable trigger for the same card, and a second
 * stop per history row would double the tabbing through a long trail.
 */
function HistoryAvatar({
  actor,
  image,
  seed,
}: {
  actor: string;
  image: string | null;
  seed: UserGlimpseSeed | null;
}) {
  const avatar = (
    <Avatar className="size-7">
      {image ? <AvatarImage alt="" src={image} /> : null}
      <AvatarFallback className="bg-chip text-[10px] font-bold text-brand">
        {initialsOf(actor)}
      </AvatarFallback>
    </Avatar>
  );

  if (!seed) return avatar;

  return (
    <UserGlimpse interactive={false} seed={seed}>
      {avatar}
    </UserGlimpse>
  );
}

/** One sentence per event, plus per-field diff lines for updates. */
function describe(
  entry: WorkItemHistoryEntry,
  lookups: Lookups,
): { phrase: string; lines: { key: string; text: string }[] } {
  const meta = entry.metadata ?? {};

  switch (entry.action) {
    case "workItem.created":
      return { phrase: "created this item", lines: [] };

    case "workItem.updated": {
      const lines = updateLines(meta, lookups);
      if (lines.length > 0) return { phrase: "updated this item", lines };
      // Entries written before diffs were recorded carry only a statusChanged
      // flag — say what little is known rather than pretending to a diff.
      return {
        phrase:
          meta.statusChanged === true
            ? "updated this item and changed its status"
            : "updated this item",
        lines: [],
      };
    }

    case "workItem.moved": {
      const lines: { key: string; text: string }[] = [];
      if (meta.fromStatusId !== meta.toStatusId) {
        lines.push({
          key: "status",
          text: `Status: ${resolve("statusId", meta.fromStatusId, lookups)} → ${resolve("statusId", meta.toStatusId, lookups)}`,
        });
      }
      if ((meta.fromSprintId ?? null) !== (meta.toSprintId ?? null)) {
        lines.push({
          key: "sprint",
          text: `Sprint: ${resolve("sprintId", meta.fromSprintId ?? null, lookups)} → ${resolve("sprintId", meta.toSprintId ?? null, lookups)}`,
        });
      }
      if (lines.length === 0) {
        return { phrase: "reordered this item in the backlog", lines };
      }
      return { phrase: "moved this item", lines };
    }

    case "workItem.assigned": {
      const to = meta.assigneeMemberId;
      return {
        phrase:
          to == null
            ? "unassigned this item"
            : `assigned this item to ${resolve("assigneeMemberId", to, lookups)}`,
        lines: [],
      };
    }

    case "workItemAttachment.created": {
      const name = textOf(meta.fileName) ?? "a file";
      const field = textOf(meta.fieldKey);
      return {
        phrase: field
          ? `attached ${name} to ${attachmentFieldLabel(field)}`
          : `attached ${name}`,
        lines: [],
      };
    }
    case "workItemAttachment.updated": {
      const from = textOf(meta.from);
      const to = textOf(meta.to);
      return {
        phrase:
          from && to && from !== to
            ? `renamed ${from} to ${to}`
            : `edited ${to ?? "an attachment"}`,
        lines: [],
      };
    }
    case "workItemAttachment.deleted":
      return {
        phrase: `deleted ${textOf(meta.fileName) ?? "an attachment"}${
          meta.moderated === true ? " (someone else's upload)" : ""
        }`,
        lines: [],
      };

    case "workItem.aiRewritten":
      return { phrase: "rewrote fields with AI assist", lines: [] };
    case "workItem.aiCriteriaSuggested":
      return {
        phrase: "generated acceptance criteria with AI assist",
        lines: [],
      };
    case "workItem.aiDefectSplit":
      return { phrase: "split this defect with AI assist", lines: [] };
    case "workItem.aiChildrenSuggested":
      return { phrase: "generated child items with AI assist", lines: [] };

    default: {
      // Future actions render their verb rather than vanishing from the trail.
      const verb = entry.action.split(".").at(-1) ?? entry.action;
      return { phrase: `performed "${verb}" on this item`, lines: [] };
    }
  }
}

/** One metadata value as a non-empty string, or null. Audit metadata is jsonb. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A stored `fieldKey` as words. Built-ins have labels; a custom field's id
 * doesn't resolve here (the trail carries no catalog), so it reads as the
 * generic noun rather than as a UUID.
 */
function attachmentFieldLabel(fieldKey: string): string {
  return WORK_ITEM_ATTACHMENT_FIELD_LABELS[fieldKey] ?? "a custom field";
}

/** Diff lines for a workItem.updated entry that carries `changes`. */
function updateLines(
  meta: Record<string, unknown>,
  lookups: Lookups,
): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];

  const changes = meta.changes;
  if (changes && typeof changes === "object") {
    for (const [field, pair] of Object.entries(
      changes as Record<string, unknown>,
    )) {
      const label = FIELD_LABELS[field];
      if (!label || !pair || typeof pair !== "object") continue;
      const { from, to } = pair as { from?: unknown; to?: unknown };
      lines.push({
        key: field,
        text: `${label}: ${resolve(field, from ?? null, lookups)} → ${resolve(field, to ?? null, lookups)}`,
      });
    }
  }

  if (Array.isArray(meta.proseChanged)) {
    for (const field of meta.proseChanged) {
      const label = PROSE_LABELS[String(field)];
      if (label) lines.push({ key: String(field), text: `${label} edited` });
    }
  }

  return lines;
}

/** A metadata value, shown as the name a person knows it by. */
function resolve(field: string, value: unknown, lookups: Lookups): string {
  switch (field) {
    case "statusId":
      return named(value, lookups.statusById);
    case "typeId":
      return named(value, lookups.typeById);
    case "sprintId":
      return value == null ? "Backlog" : named(value, lookups.sprintById);
    case "assigneeMemberId":
      return value == null ? "Unassigned" : named(value, lookups.memberById);
    case "parentId":
      return value == null ? "None" : named(value, lookups.itemById);
    case "points":
      return value == null ? "Unestimated" : `${value} ${lookups.unitLabel}`;
    case "actualEfforts":
      return value == null ? "Not recorded" : `${value} hours`;
    case "startDate":
    case "dueDate":
      return typeof value === "string"
        ? formatIsoShort(value, lookups.today)
        : "None";
    case "labels":
      return Array.isArray(value) && value.length > 0
        ? value.join(", ")
        : "None";
    case "summary":
      return typeof value === "string" ? `"${value}"` : "—";
    case "priority":
    case "businessValue":
    case "riskLevel":
      return value == null ? "None" : sentenceCase(String(value));
    default:
      return value == null ? "—" : String(value);
  }
}

function named(value: unknown, byId: Map<string, string>): string {
  if (typeof value !== "string") return "—";
  return byId.get(value) ?? "(removed)";
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(value: Date) {
  return value.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
