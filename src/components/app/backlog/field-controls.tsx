"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  IconAlertHexagon,
  IconCheck,
  IconChevronDown,
  IconInbox,
  IconTag,
  IconTrendingUp,
  IconUser,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { ParentCandidate } from "@/components/app/backlog/item-form";
import {
  PRIORITY_META,
  StatusCategoryIcon,
  typeById,
  VALUE_LEVEL_CLASSES,
  WorkItemTypeIcon,
} from "@/components/app/backlog/work-item-visuals";
import { SprintStateBadge } from "@/components/app/sprint-state-badge";
import {
  Tags,
  TagsContent,
  TagsEmpty,
  TagsGroup,
  TagsInput,
  TagsItem,
  TagsList,
  TagsTrigger,
  TagsValue,
} from "@/components/kibo-ui/tags";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  WorkItemPriority,
  WorkItemValueLevel,
} from "@/db/schema/work-items";
import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_VALUE_LABELS,
  WORK_ITEM_VALUE_LEVELS,
} from "@/db/schema/work-items";
import type {
  BacklogMemberRow,
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import { cn } from "@/lib/utils";
import { WORKFLOW_CATEGORY_CLASSES } from "@/lib/work-items";

/**
 * Rich pickers for the work-item sidebar.
 *
 * The old sidebar was a column of NativeSelects — fine for saving, useless for
 * reading. These pickers put the same visual language the board and meta band
 * already speak (type glyphs, status category icons, priority arrows, sprint
 * state lozenges, member avatars) inside the controls themselves, so the value
 * reads at a glance and every option in the menu carries its mark.
 *
 * Members and parents are comboboxes, not selects: both lists grow with the
 * org, so they are searched, capped, and honest about what was cut.
 */

// How many rows a searchable list renders before asking for a narrower query —
// same reasoning as ModelCombobox's cap: a hundred-row popup is DOM cost with
// no scanning benefit.
const MAX_RENDERED = 30;

/* -------------------------------------------------------------------------- */
/* Select-based pickers (small, fixed option sets)                            */
/* -------------------------------------------------------------------------- */

export function TypeSelect({
  id,
  value,
  onChange,
  types,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  types: WorkItemTypeRow[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next as string) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected: string) => {
            const type = types.find((entry) => entry.id === selected);
            return type ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <WorkItemTypeIcon type={type} />
                <span className="truncate">{type.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a type</span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {types.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            <WorkItemTypeIcon type={type} />
            {type.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StatusSelect({
  id,
  value,
  onChange,
  statuses,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  statuses: WorkflowStatusRow[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next as string) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected: string) => {
            const status = statuses.find((entry) => entry.id === selected);
            return status ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusCategoryIcon
                  category={status.category}
                  className={cn(
                    "shrink-0",
                    WORKFLOW_CATEGORY_CLASSES[status.category],
                  )}
                />
                <span className="truncate">{status.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a status</span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            <StatusCategoryIcon
              category={status.category}
              className={cn(
                "shrink-0",
                WORKFLOW_CATEGORY_CLASSES[status.category],
              )}
            />
            {status.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatSprintDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SprintSelect({
  id,
  value,
  onChange,
  sprints,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  sprints: BacklogSprintRow[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next as string) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected: string) => {
            const sprint = sprints.find((entry) => entry.id === selected);
            return sprint ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate">{sprint.name}</span>
                <SprintStateBadge
                  state={sprint.state}
                  className="ml-auto shrink-0"
                />
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <IconInbox
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                Backlog
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">
          <IconInbox
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          Backlog
        </SelectItem>
        {sprints.map((sprint) => (
          <SelectItem key={sprint.id} value={sprint.id}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{sprint.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatSprintDate(sprint.startDate)} –{" "}
                  {formatSprintDate(sprint.endDate)}
                </span>
              </span>
              <SprintStateBadge
                state={sprint.state}
                className="ml-auto shrink-0"
              />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: WorkItemPriority;
  onChange: (value: WorkItemPriority) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next as WorkItemPriority) ?? "medium")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected: WorkItemPriority) => {
            const meta = PRIORITY_META[selected] ?? PRIORITY_META.medium;
            const Icon = meta.icon;
            return (
              <span className="flex items-center gap-1.5">
                <Icon
                  className={cn("size-4 shrink-0", meta.className)}
                  stroke={2.2}
                  aria-hidden
                />
                {WORK_ITEM_PRIORITY_LABELS[selected] ?? selected}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {WORK_ITEM_PRIORITIES.map((priority) => {
          const meta = PRIORITY_META[priority];
          const Icon = meta.icon;
          return (
            <SelectItem key={priority} value={priority}>
              <Icon
                className={cn("size-4 shrink-0", meta.className)}
                stroke={2.2}
                aria-hidden
              />
              {WORK_ITEM_PRIORITY_LABELS[priority]}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Business value and risk: one four-step scale, the icon names the dimension. */
export function ValueLevelSelect({
  id,
  kind,
  value,
  onChange,
  disabled,
}: {
  id: string;
  kind: "value" | "risk";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const Icon = kind === "value" ? IconTrendingUp : IconAlertHexagon;
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next as string) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(selected: string) => {
            const level = WORK_ITEM_VALUE_LEVELS.includes(
              selected as WorkItemValueLevel,
            )
              ? (selected as WorkItemValueLevel)
              : null;
            return (
              <span className="flex items-center gap-1.5">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    level
                      ? VALUE_LEVEL_CLASSES[level]
                      : "text-muted-foreground/60",
                  )}
                  aria-hidden
                />
                {level ? (
                  WORK_ITEM_VALUE_LABELS[level]
                ) : (
                  <span className="text-muted-foreground">Not assessed</span>
                )}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">
          <Icon
            className="size-4 shrink-0 text-muted-foreground/60"
            aria-hidden
          />
          Not assessed
        </SelectItem>
        {WORK_ITEM_VALUE_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            <Icon
              className={cn("size-4 shrink-0", VALUE_LEVEL_CLASSES[level])}
              aria-hidden
            />
            {WORK_ITEM_VALUE_LABELS[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* Combobox-based pickers (lists that grow with the org — searched + capped)  */
/* -------------------------------------------------------------------------- */

/** Same geometry as SelectTrigger, so the two control families sit flush. */
const PICKER_TRIGGER =
  "flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm whitespace-nowrap transition-[color,box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

type PickerOption = {
  value: string;
  /** What typing filters against — name + email, key + summary, … */
  search: string;
  /** The list row (roomy, two lines allowed). */
  row: React.ReactNode;
  /** The trigger rendering (one line, truncates). */
  display: React.ReactNode;
};

/**
 * A select that searches: button trigger, popup with a filter input, capped
 * list. Selection state stays a plain string so the form never changes shape.
 */
function PickerCombobox({
  id,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  searchPlaceholder,
  emptyText,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? options.filter((option) =>
            option.search.toLowerCase().includes(needle),
          )
        : options,
    [options, needle],
  );
  const visible = matches.slice(0, MAX_RENDERED);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox<string>
      items={visible.map((option) => option.value)}
      filter={null}
      value={value}
      onValueChange={(next) => onChange(next ?? "")}
      inputValue={query}
      onInputValueChange={(next, details) => {
        // Only real typing is a search term. Base UI also writes the selected
        // value back into the input on item-press — for a button-triggered
        // picker that write is noise, and keeping it would filter the next
        // open down to the row already chosen.
        if (details.reason === "input-change") setQuery(next);
      }}
      onOpenChange={(open) => {
        if (open) setQuery("");
      }}
      disabled={disabled}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        className={PICKER_TRIGGER}
        disabled={disabled}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {selected ? (
            selected.display
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <IconChevronDown
          className="pointer-events-none size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxContent>
        <ComboboxInput
          placeholder={searchPlaceholder}
          showTrigger={false}
          autoFocus
        />
        <ComboboxList>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          {visible.map((option) => (
            <ComboboxItem key={option.value} value={option.value}>
              {option.row}
            </ComboboxItem>
          ))}
        </ComboboxList>
        {matches.length > visible.length ? (
          <div className="border-border border-t px-3 py-2 text-xs text-muted-foreground tabular-nums">
            Showing {visible.length} of {matches.length} — keep typing to
            narrow.
          </div>
        ) : null}
      </ComboboxContent>
    </Combobox>
  );
}

function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

function MemberAvatar({
  member,
  className,
}: {
  member: BacklogMemberRow;
  className?: string;
}) {
  return (
    <Avatar size="sm" className={className}>
      {member.image ? <AvatarImage src={member.image} alt="" /> : null}
      <AvatarFallback className="text-[10px]">
        {memberInitials(member.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Assignee (and any custom "user" field): searchable by name or email, each
 * row a photo + name + email tile, "Unassigned" as an explicit first choice.
 */
export function MemberCombobox({
  id,
  value,
  onChange,
  members,
  disabled,
  unassignedLabel = "Unassigned",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  members: BacklogMemberRow[];
  disabled?: boolean;
  unassignedLabel?: string;
}) {
  const options = useMemo<PickerOption[]>(
    () => [
      {
        value: "",
        search: unassignedLabel,
        row: (
          <span className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border border-dashed text-muted-foreground">
              <IconUser className="size-3.5" aria-hidden />
            </span>
            <span className="text-muted-foreground">{unassignedLabel}</span>
          </span>
        ),
        display: (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <IconUser className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{unassignedLabel}</span>
          </span>
        ),
      },
      ...members.map((member) => ({
        value: member.memberId,
        search: `${member.name} ${member.email}`,
        row: (
          <span className="flex min-w-0 items-center gap-2.5">
            <MemberAvatar member={member} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{member.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {member.email}
              </span>
            </span>
          </span>
        ),
        display: (
          <span className="flex min-w-0 items-center gap-1.5">
            <MemberAvatar member={member} className="size-5" />
            <span className="truncate">{member.name}</span>
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
              {member.email}
            </span>
          </span>
        ),
      })),
    ],
    [members, unassignedLabel],
  );

  return (
    <PickerCombobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={unassignedLabel}
      searchPlaceholder="Search by name or email…"
      emptyText="No members match."
    />
  );
}

/** Parent: searchable by key or summary, each row a type glyph + key + name. */
export function ParentCombobox({
  id,
  value,
  onChange,
  candidates,
  types,
  disabled,
  allowNone = true,
  placeholder = "None",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  candidates: ParentCandidate[];
  types: WorkItemTypeRow[];
  disabled?: boolean;
  /**
   * A form FIELD needs an explicit "None" row — clearing it is a real choice.
   * A link picker doesn't: "nothing chosen yet" is the resting state there, and
   * a None row would read as an item you could link.
   */
  allowNone?: boolean;
  placeholder?: string;
}) {
  const options = useMemo<PickerOption[]>(
    () => [
      ...(allowNone
        ? [
            {
              value: "",
              search: "none",
              row: <span className="text-muted-foreground">None</span>,
              display: <span className="text-muted-foreground">None</span>,
            },
          ]
        : []),
      ...candidates.map((candidate) => {
        const type = typeById(types, candidate.typeId);
        return {
          value: candidate.id,
          search: `${candidate.key} ${candidate.summary}`,
          row: (
            <span className="flex min-w-0 items-center gap-2">
              <WorkItemTypeIcon type={type} />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {candidate.key}
              </span>
              <span className="truncate">{candidate.summary}</span>
            </span>
          ),
          display: (
            <span className="flex min-w-0 items-center gap-1.5">
              <WorkItemTypeIcon type={type} />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {candidate.key}
              </span>
              <span className="truncate">{candidate.summary}</span>
            </span>
          ),
        };
      }),
    ],
    [candidates, types, allowNone],
  );

  return (
    <PickerCombobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder="Search by key or name…"
      emptyText="No items match."
    />
  );
}

/**
 * The labels control: selected labels sit in the trigger as removable chips,
 * the popover offers every label the project has already used, and anything
 * typed that doesn't exist yet becomes a "Create" row — free text stays free,
 * it just stops being comma syntax the author has to know.
 *
 * Lives here rather than in the item form because the inline backlog composer
 * writes the same field: two label pickers would be two answers to "is this a
 * new tag or a typo of an existing one".
 */
export function LabelsTagPicker({
  id,
  value,
  suggestions,
  disabled,
  onChange,
}: {
  id: string;
  value: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = Array.from(new Set([...suggestions, ...value])).sort((a, b) =>
    a.localeCompare(b),
  );
  const trimmed = query.trim();
  const creatable =
    trimmed.length > 0 &&
    !options.some((option) => option.toLowerCase() === trimmed.toLowerCase());

  function toggle(label: string) {
    onChange(
      value.includes(label)
        ? value.filter((existing) => existing !== label)
        : [...value, label],
    );
  }

  return (
    <Tags>
      <TagsTrigger
        id={id}
        disabled={disabled}
        placeholder={value.length > 0 ? "Add label..." : "Add labels..."}
      >
        {value.map((label) => (
          <TagsValue
            key={label}
            variant="secondary"
            className="min-w-0"
            onRemove={disabled ? undefined : () => toggle(label)}
          >
            <IconTag className="size-3.5 shrink-0 text-brand" aria-hidden />
            <span className="truncate">{label}</span>
          </TagsValue>
        ))}
      </TagsTrigger>
      <TagsContent>
        <TagsInput
          placeholder="Search or create..."
          value={query}
          onValueChange={setQuery}
        />
        <TagsList>
          <TagsEmpty>
            {trimmed ? "No matching label." : "Type to create a label."}
          </TagsEmpty>
          <TagsGroup>
            {options.map((option) => (
              <TagsItem
                key={option}
                value={option}
                onSelect={() => toggle(option)}
              >
                <span className="min-w-0 truncate">{option}</span>
                {value.includes(option) ? (
                  <IconCheck
                    className="size-4 shrink-0 text-brand"
                    aria-hidden
                  />
                ) : null}
              </TagsItem>
            ))}
            {creatable ? (
              <TagsItem
                value={trimmed}
                onSelect={() => {
                  toggle(trimmed);
                  setQuery("");
                }}
              >
                Create &ldquo;{trimmed}&rdquo;
              </TagsItem>
            ) : null}
          </TagsGroup>
        </TagsList>
      </TagsContent>
    </Tags>
  );
}
