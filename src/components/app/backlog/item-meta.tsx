import { IconArrowBigUpLine, IconUserCircle } from "@tabler/icons-react";
import Link from "next/link";
import {
  LabelChip,
  PriorityMark,
  StatusCategoryIcon,
  ValueChip,
} from "@/components/app/backlog/work-item-visuals";
import { UserGlimpse } from "@/components/app/user-glimpse";
import { WORK_ITEM_PRIORITY_LABELS } from "@/db/schema/work-items";
import type {
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
} from "@/lib/actions/work-items";
import { compareIso, formatIsoShort, todayIso } from "@/lib/date-only";
import type { EffectiveEstimate } from "@/lib/estimate-rollup";
import { cn } from "@/lib/utils";
import { initialsOf, WORKFLOW_CATEGORY_CLASSES } from "@/lib/work-items";

/**
 * The read-only band above the item form: where this item currently stands, and
 * what it's attached to.
 *
 * Deliberately not editable — everything here is also a control in the form
 * below. Its job is the answer you want at a glance after following a link,
 * without reading a column of selects to work it out.
 *
 * The facts are a FIELD STRIP, not a grid of tiles: label over value, split by
 * hairlines. An earlier pass gave every fact a bordered tile holding a tinted
 * icon square holding a chip — three nested surfaces to say one word, and the
 * icon squares said in colour what the chip beside them already said in text.
 * Here the cell is the container, and the only colour is the small mark on the
 * value itself (DS v0.3: "neutral chips, coloured marks"). Type is gone from
 * the strip entirely — the page eyebrow above already reads "Story · PROJ-3".
 *
 * Parent and children used to trail this card; they moved to `ItemRelations`
 * when they gained controls, so that this one stays purely read-only.
 */
export function ItemMeta({
  item,
  estimate,
  statuses,
  sprints,
  reporterName,
  basePath,
  projectId,
  capacityUnit,
}: {
  item: WorkItemRow;
  /** The item's estimate, own or rolled up from its children. */
  estimate: EffectiveEstimate;
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  reporterName: string | null;
  basePath: string;
  /** Context for the person hover cards: "their role on THIS project". */
  projectId: string;
  capacityUnit: "hours" | "points";
}) {
  const status = statuses.find((row) => row.id === item.statusId);
  const sprint = sprints.find((row) => row.id === item.sprintId);

  const statusCategory = status?.category ?? "todo";

  // Overdue is a fact about an UNFINISHED item — a date that passed before the
  // work was completed is history, not a warning, so a done item never nags.
  const today = todayIso();
  const overdue =
    item.dueDate !== null &&
    status?.category !== "done" &&
    compareIso(item.dueDate, today) < 0;

  const unitLabel = capacityUnit === "points" ? "points" : "hours";

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      {/* The negative right/bottom margin lets every cell carry the same two
          borders and have the outer ones clipped by the parent's overflow —
          which keeps the hairlines correct at ANY column count, where
          `divide-x` would draw a stray left edge on each wrapped row. */}
      <dl className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7">
        <Field label="Status">
          {status ? (
            <>
              <StatusCategoryIcon
                category={statusCategory}
                className={cn(
                  "size-4 shrink-0",
                  WORKFLOW_CATEGORY_CLASSES[statusCategory],
                )}
              />
              <span className="truncate">{status.name}</span>
            </>
          ) : (
            <Unset>Unknown</Unset>
          )}
        </Field>

        <Field label="Assignee">
          {item.assigneeName ? (
            <UserGlimpse
              className="flex min-w-0 items-center gap-1.5"
              projectId={projectId}
              seed={{
                memberId: item.assigneeMemberId,
                name: item.assigneeName,
                image: item.assigneeImage,
              }}
            >
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full bg-chip text-[9px] font-bold tracking-tight text-brand"
              >
                {initialsOf(item.assigneeName)}
              </span>
              <span className="truncate">{item.assigneeName}</span>
            </UserGlimpse>
          ) : (
            <Unset>Unassigned</Unset>
          )}
        </Field>

        <Field label="Priority">
          <PriorityMark priority={item.priority} className="shrink-0" />
          <span className="truncate">
            {WORK_ITEM_PRIORITY_LABELS[item.priority]}
          </span>
        </Field>

        <Field label="Sprint">
          {sprint ? (
            <Link
              href={`${basePath}/sprints/${sprint.id}`}
              className="truncate text-brand hover:underline"
            >
              {sprint.name}
            </Link>
          ) : (
            <Unset>Backlog</Unset>
          )}
        </Field>

        <Field label={overdue ? "Overdue" : "Due"}>
          {item.dueDate ? (
            <span
              className={cn(
                "truncate tabular-nums",
                overdue && "text-destructive",
              )}
              title={item.dueDate}
            >
              {formatIsoShort(item.dueDate, today)}
            </span>
          ) : (
            <Unset>No date</Unset>
          )}
        </Field>

        <Field label="Estimated efforts">
          {estimate.value === null ? (
            <Unset>Unestimated</Unset>
          ) : (
            // Where the number came from is stated in words, not just in
            // weight: "8 hours" and "8 hours from 3 items" are different facts,
            // and the second one changes when a child is re-estimated.
            <span className="truncate tabular-nums">
              {estimate.value}{" "}
              <span className="font-normal text-muted-foreground">
                {unitLabel}
                {estimate.source === "rollup"
                  ? ` from ${estimate.contributors} item${
                      estimate.contributors === 1 ? "" : "s"
                    }`
                  : ""}
              </span>
            </span>
          )}
        </Field>

        <Field label="Actual efforts">
          {item.actualEfforts === null ? (
            <Unset>Not recorded</Unset>
          ) : (
            <span className="truncate tabular-nums">
              {item.actualEfforts}{" "}
              <span className="font-normal text-muted-foreground">hours</span>
            </span>
          )}
        </Field>
      </dl>

      {/* The second tier: facts that are often unset, so they earn a place only
          when they hold something rather than a strip of em-dashes. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-sm">
        {item.businessValue ? (
          <ValueChip kind="value" level={item.businessValue} />
        ) : null}
        {item.riskLevel ? (
          <ValueChip kind="risk" level={item.riskLevel} />
        ) : null}

        {item.startDate ? (
          <Fact
            icon={
              <IconArrowBigUpLine
                className="size-4 rotate-90 text-chart-3"
                aria-hidden
              />
            }
          >
            <span className="text-muted-foreground">Starts</span>{" "}
            <span className="font-semibold tabular-nums">
              {formatIsoShort(item.startDate, today)}
            </span>
          </Fact>
        ) : null}

        <Fact
          icon={
            <IconUserCircle
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          }
        >
          <span className="text-muted-foreground">Reported by</span>{" "}
          {reporterName ? (
            <UserGlimpse
              className="font-semibold"
              projectId={projectId}
              seed={{ memberId: item.reporterMemberId, name: reporterName }}
            >
              {reporterName}
            </UserGlimpse>
          ) : (
            <span className="font-semibold">—</span>
          )}
        </Fact>

        {item.labels.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {item.labels.map((label) => (
              <LabelChip key={label} label={label} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One cell of the field strip: uppercase label over the value, the cell's own
 * two hairlines, and nothing else — no inner surface, no icon square. The value
 * row is a flex line so a mark (status glyph, priority arrow, avatar) can lead
 * it without becoming a second container.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-border border-r border-b px-4 py-3">
      <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        {children}
      </dd>
    </div>
  );
}

/** An empty value: same size and weight, muted so it recedes from the facts. */
function Unset({ children }: { children: React.ReactNode }) {
  return (
    <span className="truncate font-normal text-muted-foreground">
      {children}
    </span>
  );
}

function Fact({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {children}
    </span>
  );
}
