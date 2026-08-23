"use client";

import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCategory,
  IconChartBar,
  IconChecklist,
  IconCircleCheck,
  IconClipboardText,
  IconCode,
  IconDeviceFloppy,
  IconListNumbers,
  IconNotes,
  IconPaperclip,
  IconSitemap,
  IconTargetArrow,
  IconTrash,
  IconUserSquareRounded,
  IconX,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type AiDraft,
  AiDraftCard,
  AiItemTools,
} from "@/components/app/backlog/ai-item-tools";
import {
  AttachmentDropzone,
  useAttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import { CustomFieldInput } from "@/components/app/backlog/custom-field-input";
import {
  LabelsTagPicker,
  MemberCombobox,
  ParentCombobox,
  PrioritySelect,
  SprintSelect,
  StatusSelect,
  TypeSelect,
  ValueLevelSelect,
} from "@/components/app/backlog/field-controls";
import { RichTextField } from "@/components/app/backlog/rich-text-field";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type {
  WorkItemPriority,
  WorkItemValueLevel,
} from "@/db/schema/work-items";
import type {
  BacklogMemberRow,
  BacklogSprintRow,
  WorkflowStatusRow,
  WorkItemRow,
  WorkItemTypeRow,
} from "@/lib/actions/work-items";
import {
  createWorkItem,
  deleteWorkItem,
  updateWorkItem,
} from "@/lib/actions/work-items";
import { formatBytes } from "@/lib/format-bytes";
import { withReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";
import {
  batchedForUpload,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENTS_PER_REQUEST,
  WORK_ITEM_ATTACHMENT_FIELD_LABELS,
} from "@/lib/work-item-attachments";
import {
  fieldsForPlacement,
  fieldsForType,
  missingRequiredFields,
  type WorkItemFieldDefinition,
} from "@/lib/work-item-fields";
import { canParent } from "@/lib/work-items";

/** A candidate parent — everything the picker needs, nothing it doesn't. */
export type ParentCandidate = {
  id: string;
  key: string;
  summary: string;
  typeId: string;
  /**
   * Where the candidate currently hangs. The form's parent picker ignores it;
   * the hierarchy panel uses it to warn that linking an item that already has a
   * parent MOVES it rather than adding a second link.
   */
  parentId?: string | null;
};

type FormState = {
  typeId: string;
  statusId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  technicalNotes: string;
  definitionOfDone: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  businessValue: string;
  riskLevel: string;
  priority: WorkItemPriority;
  points: string;
  actualEfforts: string;
  assigneeMemberId: string;
  parentId: string;
  sprintId: string;
  startDate: string;
  dueDate: string;
  labels: string[];
  customFields: Record<string, unknown>;
};

/** Mirrors `workItemDescriptionSchema` in src/lib/validation/work-items.ts. */
const WORK_ITEM_PROSE_LIMIT = 20_000;

/** The markdown blocks, with the label to name in a too-long error. */
type ProseKey =
  | "description"
  | "acceptanceCriteria"
  | "technicalNotes"
  | "definitionOfDone"
  | "stepsToReproduce"
  | "expectedResult"
  | "actualResult";

const PROSE_BLOCKS: [ProseKey, string][] = [
  ["description", "Description"],
  ["acceptanceCriteria", "Acceptance criteria"],
  ["technicalNotes", "Technical notes"],
  ["definitionOfDone", "Definition of done"],
  ["stepsToReproduce", "Steps to reproduce"],
  ["expectedResult", "Expected"],
  ["actualResult", "Actual"],
];

/**
 * The sidebar's fields. In edit mode a change to any of these saves on its
 * own; the Save/Cancel bar governs only the main (content) column.
 */
const META_KEYS = new Set<keyof FormState>([
  "typeId",
  "statusId",
  "priority",
  "points",
  "actualEfforts",
  "assigneeMemberId",
  "parentId",
  "sprintId",
  "startDate",
  "dueDate",
  "businessValue",
  "riskLevel",
  "labels",
]);

/**
 * The main column's slice of the form — what the Save button owns. Kept as a
 * snapshot of the last PERSISTED values so a meta autosave (which must send
 * the whole item — the update action is a full replace) can never carry a
 * half-typed description along with it.
 */
type MainSnapshot = Pick<FormState, "summary" | ProseKey | "customFields">;

function mainSnapshot(state: FormState): MainSnapshot {
  return {
    summary: state.summary,
    description: state.description,
    acceptanceCriteria: state.acceptanceCriteria,
    technicalNotes: state.technicalNotes,
    definitionOfDone: state.definitionOfDone,
    stepsToReproduce: state.stepsToReproduce,
    expectedResult: state.expectedResult,
    actualResult: state.actualResult,
    customFields: { ...state.customFields },
  };
}

/**
 * The wire shape both the Save button and a meta autosave submit.
 *
 * `parentId` is sent ONLY when this form is the control that owns it — create
 * mode, or an edit render with no hierarchy panel. When the panel is present it
 * writes the link through `setWorkItemParent`, and an update carrying this
 * form's copy would undo that move as soon as a debounced autosave fired with
 * the value it held when the timer was scheduled (the prop-sync effect below
 * lands too late for a write already in flight). `updateWorkItem` reads an
 * absent key as "leave the parent alone"; an explicit `null` still detaches.
 */
function buildPayload(state: FormState, includeParent: boolean) {
  return {
    typeId: state.typeId,
    statusId: state.statusId,
    summary: state.summary.trim(),
    description: state.description.trim() || undefined,
    acceptanceCriteria: state.acceptanceCriteria.trim() || undefined,
    technicalNotes: state.technicalNotes.trim() || undefined,
    definitionOfDone: state.definitionOfDone.trim() || undefined,
    stepsToReproduce: state.stepsToReproduce.trim() || undefined,
    expectedResult: state.expectedResult.trim() || undefined,
    actualResult: state.actualResult.trim() || undefined,
    businessValue: (state.businessValue || null) as WorkItemValueLevel | null,
    riskLevel: (state.riskLevel || null) as WorkItemValueLevel | null,
    priority: state.priority,
    points: state.points === "" ? null : Number(state.points),
    actualEfforts:
      state.actualEfforts === "" ? null : Number(state.actualEfforts),
    assigneeMemberId: state.assigneeMemberId || null,
    ...(includeParent ? { parentId: state.parentId || null } : {}),
    sprintId: state.sprintId || null,
    startDate: state.startDate || null,
    dueDate: state.dueDate || null,
    labels: state.labels,
    customFields: state.customFields,
  };
}

/**
 * Create-page defaults, taken from the URL
 * (?type=&status=&sprint=&summary=&parent=&assignee=&priority=&points=&label=).
 * They are SEEDS: every one of them lands in an editable field, and an item
 * always exists before any of them means anything.
 */
type CreatePresets = {
  typeId?: string;
  statusId?: string;
  sprintId?: string;
  summary?: string;
  parentId?: string;
  assigneeMemberId?: string;
  priority?: WorkItemPriority;
  /** Already a string — the field itself holds the raw text. */
  points?: string;
  labels?: string[];
};

function seedForm(
  item: WorkItemRow | null,
  types: WorkItemTypeRow[],
  statuses: WorkflowStatusRow[],
  presets?: CreatePresets,
): FormState {
  const defaultType =
    types.find((type) => type.id === presets?.typeId) ??
    types.find((type) => type.isDefault) ??
    types[0];
  const defaultStatus =
    statuses.find((status) => status.id === presets?.statusId) ??
    statuses.find((status) => status.isDefault) ??
    statuses[0];
  return {
    typeId: item?.typeId ?? defaultType?.id ?? "",
    statusId: item?.statusId ?? defaultStatus?.id ?? "",
    summary: item?.summary ?? presets?.summary ?? "",
    description: item?.description ?? "",
    acceptanceCriteria: item?.acceptanceCriteria ?? "",
    technicalNotes: item?.technicalNotes ?? "",
    definitionOfDone: item?.definitionOfDone ?? "",
    stepsToReproduce: item?.stepsToReproduce ?? "",
    expectedResult: item?.expectedResult ?? "",
    actualResult: item?.actualResult ?? "",
    businessValue: item?.businessValue ?? "",
    riskLevel: item?.riskLevel ?? "",
    priority: item?.priority ?? presets?.priority ?? "medium",
    points:
      item?.points === null || item?.points === undefined
        ? (presets?.points ?? "")
        : String(item.points),
    actualEfforts:
      item?.actualEfforts === null || item?.actualEfforts === undefined
        ? ""
        : String(item.actualEfforts),
    assigneeMemberId: item?.assigneeMemberId ?? presets?.assigneeMemberId ?? "",
    parentId: item?.parentId ?? presets?.parentId ?? "",
    sprintId: item?.sprintId ?? presets?.sprintId ?? "",
    startDate: item?.startDate ?? "",
    dueDate: item?.dueDate ?? "",
    labels: item?.labels ?? presets?.labels ?? [],
    customFields: { ...(item?.customFields ?? {}) },
  };
}

/**
 * The work item form — one component for create and edit, rendered as a PAGE
 * rather than a dialog.
 *
 * A work item is a document: description, acceptance criteria, technical notes
 * and definition of done are meant to be written and read at length, and a
 * modal that scrolls inside a 70vh box fights that. A route also makes an item
 * linkable, back-buttonable and refreshable, which a dialog never was.
 *
 * Layout is content + meta: what the item IS reads down the main column, while
 * where it sits (type, status, sprint, assignee, dates) stays in a sidebar that
 * never pushes the writing off screen.
 */
export function ItemForm({
  mode,
  item,
  projectId,
  basePath,
  returnTo = null,
  types,
  statuses,
  sprints,
  members,
  siblings,
  fields,
  abilities,
  capacityUnit,
  rolledEstimate = null,
  presets,
  labelSuggestions = [],
  activity,
  relations,
}: {
  mode: "create" | "edit";
  item: WorkItemRow | null;
  projectId: string;
  basePath: string;
  /**
   * The screen this form was opened from, already sanitized by the page (see
   * `src/lib/return-to.ts`). Cancel and delete land there instead of on the
   * backlog, and it rides along to the item a create produces — leaving the
   * form should never cost the reader the board or sprint they were working in.
   */
  returnTo?: string | null;
  types: WorkItemTypeRow[];
  statuses: WorkflowStatusRow[];
  sprints: BacklogSprintRow[];
  members: BacklogMemberRow[];
  siblings: ParentCandidate[];
  fields: WorkItemFieldDefinition[];
  abilities: {
    create: boolean;
    update: boolean;
    delete: boolean;
    /** attachment:create — whether files may be dropped on this form at all. */
    attach: boolean;
  };
  capacityUnit: "hours" | "points";
  /**
   * The estimate this item's children add up to, when it has no estimate of its
   * own — the value the empty field is really holding. Null when the item was
   * estimated directly or has nothing broken out under it.
   */
  rolledEstimate?: number | null;
  /**
   * Create-page defaults (see `CreatePresets`). `summary` is what the board's
   * quick composer had already typed when it handed over — nobody should type a
   * title twice — `parent` is the item whose hierarchy panel sent you here, and
   * the rest is what the backlog's inline composer had already picked before it
   * handed the row over.
   */
  presets?: CreatePresets;
  /** Labels already used across the project, offered as picker suggestions. */
  labelSuggestions?: string[];
  /**
   * The item's activity panel (history now, comments later), rendered in the
   * main column below the action bar so it lines up with the content it
   * narrates rather than spanning under the sidebar.
   */
  activity?: React.ReactNode;
  /**
   * The item's hierarchy panel (`ItemRelations`), slotted into the sidebar's
   * Relations section in place of its parent picker. Edit mode only — adopting
   * a child needs an item id, which create mode doesn't have yet.
   */
  relations?: React.ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    seedForm(item, types, statuses, presets),
  );
  const [pending, startTransition] = useTransition();
  const [metaSaving, setMetaSaving] = useState(false);
  // The autosave fires from a timeout, so it reads the LATEST form through a
  // ref rather than the render it was scheduled in.
  const formRef = useRef(form);
  formRef.current = form;
  // What the server currently holds for the main column. Autosaves send this
  // instead of live form values; the Save button is what advances it.
  const savedMainRef = useRef<MainSnapshot | null>(null);
  if (savedMainRef.current === null) savedMainRef.current = mainSnapshot(form);
  const metaSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(metaSaveTimer.current), []);

  // An hour-based estimate opens at the current hour, so the number in the box
  // is one someone adjusts rather than one they type from nothing. The clock is
  // read on MOUNT, never during render: this component server-renders too, and
  // a reader three timezones from the server would hydrate over a different
  // hour than the markup carries. Create mode only, and never over a preset or
  // a value already in the box — an estimate someone supplied is a decision.
  // Direct setForm, not `set()`: seeding must not schedule a write.
  const seedsHourEstimate = item === null && capacityUnit === "hours";
  useEffect(() => {
    if (!seedsHourEstimate) return;
    setForm((current) =>
      current.points === ""
        ? { ...current, points: String(new Date().getHours()) }
        : current,
    );
  }, [seedsHourEstimate]);

  // Whether this form is the control that owns the parent link. When the
  // hierarchy panel is rendered it owns it instead, and this form must leave
  // `parentId` out of every payload it sends — see `buildPayload`.
  const ownsParent = relations === undefined || relations === null;

  // The hierarchy panel writes `parentId` through its own action, so the server
  // value can move while this form stays mounted. Nothing is at stake in a
  // payload any more (the field is omitted when the panel owns it), but the
  // picker and the form state still have to agree with the server when this
  // form IS the owner — re-seed the field whenever the server's value moves.
  // Direct setForm, never `set()`: adopting the server's own value must not
  // schedule a write back to it.
  const serverParentId = item?.parentId ?? "";
  useEffect(() => {
    setForm((current) =>
      current.parentId === serverParentId
        ? current
        : { ...current, parentId: serverParentId },
    );
  }, [serverParentId]);
  // The prose editors are uncontrolled — they seed from `value` once and then
  // own their document. An AI suggestion the author accepts is written straight
  // into the live editor, but a suggestion that lands in a DIFFERENT field
  // (criteria written from the description, a defect report split three ways)
  // has no editor to write into, so that field is remounted to re-seed.
  const [revisions, setRevisions] = useState<Partial<Record<ProseKey, number>>>(
    {},
  );

  function reseed(...keys: ProseKey[]) {
    setRevisions((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = (next[key] ?? 0) + 1;
      return next;
    });
  }

  const selectedType = types.find((type) => type.id === form.typeId);
  const activeFields = fieldsForType(fields, form.typeId || null);
  // Each field carries where its org wants it: with the content in the main
  // column, or with the meta in the sidebar. Required-ness is checked across
  // both — a field doesn't stop being required because it sits in the sidebar.
  const mainFields = fieldsForPlacement(activeFields, "main");
  const sideFields = fieldsForPlacement(activeFields, "side");
  const missing = missingRequiredFields(activeFields, form.customFields);

  // The level rule, restated — the same one the server enforces, so the picker
  // can't offer a choice it will refuse. This item is the CHILD here, so the
  // rule is read off the type it currently has selected: a type with
  // `strictHierarchy` off may be filed under anything.
  const parentCandidates = siblings.filter((candidate) => {
    if (candidate.id === item?.id) return false;
    const candidateType = types.find((type) => type.id === candidate.typeId);
    return (
      candidateType &&
      selectedType &&
      canParent(
        candidateType.hierarchyLevel,
        selectedType.hierarchyLevel,
        selectedType.strictHierarchy,
      )
    );
  });

  // Whether anything could sit UNDER this item — the mirror of the parent rule,
  // and what decides if breaking it down is even offered. Each candidate type
  // is the child in that pairing, so each answers with its own flag.
  const canHoldChildren = types.some(
    (type) =>
      selectedType &&
      canParent(
        selectedType.hierarchyLevel,
        type.hierarchyLevel,
        type.strictHierarchy,
      ),
  );

  const readOnly = mode === "edit" ? !abilities.update : !abilities.create;
  // Only an existing, editable item autosaves — in create mode there is
  // nothing to write to until the Create button makes the item.
  const autosaves = mode === "edit" && item !== null && !readOnly;
  const sideFieldIds = new Set(sideFields.map((field) => field.id));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (autosaves && META_KEYS.has(key)) scheduleMetaSave();
  }

  function setCustomField(fieldId: string, value: unknown) {
    setForm((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: value },
    }));
    if (autosaves && sideFieldIds.has(fieldId)) scheduleMetaSave();
  }

  /**
   * Debounced so a date typed digit by digit lands as one write, not six.
   * The timeout reads `formRef` when it fires, so it always saves the latest
   * values no matter which render scheduled it.
   */
  function scheduleMetaSave() {
    clearTimeout(metaSaveTimer.current);
    metaSaveTimer.current = setTimeout(saveMeta, 600);
  }

  function saveMeta() {
    if (!item) return;
    const current = formRef.current;
    const saved = savedMainRef.current;
    if (!saved) return;

    // The update action replaces the whole item, so the payload is stitched:
    // meta from the live form, main content from the last persisted snapshot —
    // side-placed custom fields are meta, main-placed ones stay at their
    // saved values.
    const active = fieldsForType(fields, current.typeId || null);
    const sideIds = new Set(
      fieldsForPlacement(active, "side").map((field) => field.id),
    );
    const customFields = { ...saved.customFields };
    for (const id of Object.keys(current.customFields)) {
      if (sideIds.has(id)) customFields[id] = current.customFields[id];
    }
    const merged: FormState = { ...current, ...saved, customFields };

    const missingMeta = missingRequiredFields(active, customFields).filter(
      (field) => sideIds.has(field.id),
    );
    if (missingMeta.length > 0) {
      toast.error(
        `${missingMeta.map((field) => field.label).join(", ")} ${missingMeta.length === 1 ? "is" : "are"} required.`,
      );
      return;
    }

    setMetaSaving(true);
    updateWorkItem({ workItemId: item.id, ...buildPayload(merged, ownsParent) })
      .then(() => router.refresh())
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Couldn't save that change.",
        );
      })
      .finally(() => setMetaSaving(false));
  }

  /**
   * A generated draft fills what is still empty and never overwrites what
   * someone already typed — the assistant is a head start, not an editor with
   * opinions about work in progress.
   */
  function applyDraft(draft: AiDraft) {
    setForm((current) => ({
      ...current,
      summary: current.summary.trim() || draft.summary,
      description: current.description.trim() || draft.description,
      acceptanceCriteria:
        current.acceptanceCriteria.trim() || draft.acceptanceCriteria,
      technicalNotes: current.technicalNotes.trim() || draft.technicalNotes,
      typeId: draft.typeId ?? current.typeId,
      priority: draft.priority ?? current.priority,
      labels: current.labels.length > 0 ? current.labels : draft.labels,
    }));
    reseed("description", "acceptanceCriteria", "technicalNotes");
  }

  function submit() {
    // Prose blocks now carry markdown, so the stored string is longer than what
    // is on screen — check it here rather than letting the server's zod cap come
    // back as an unreadable parse error.
    const tooLong = PROSE_BLOCKS.filter(
      ([key]) => form[key].length > WORK_ITEM_PROSE_LIMIT,
    );
    if (tooLong.length > 0) {
      toast.error(
        `${tooLong.map(([, label]) => label).join(", ")} ${tooLong.length === 1 ? "is" : "are"} over the ${WORK_ITEM_PROSE_LIMIT.toLocaleString()} character limit.`,
      );
      return;
    }

    if (missing.length > 0) {
      toast.error(
        `${missing.map((field) => field.label).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`,
      );
      return;
    }

    const submitted = form;
    const payload = buildPayload(submitted, ownsParent);

    startTransition(async () => {
      try {
        if (item) {
          await updateWorkItem({ workItemId: item.id, ...payload });
          // The main column is now persisted — future meta autosaves build on
          // these values instead of the ones from page load.
          savedMainRef.current = mainSnapshot(submitted);
          toast.success(`${item.key} saved.`);
          router.refresh();
        } else {
          const created = await createWorkItem({ projectId, ...payload });
          // Held drops become real attachments now that there is something to
          // hang them off. Sent before navigating so the detail page renders
          // with the files already on it; a failure here reports itself and
          // does not undo the item that was created.
          if (staged.length > 0) {
            const { failed, reason } = await uploadStagedAttachments(
              created.id,
              staged,
            );
            // Only what actually landed is cleared. The files that didn't are
            // named, because the browser can't hand them back after the
            // navigation below and a silent drop is how someone loses the log
            // they were filing the bug about.
            setStaged(failed);
            if (failed.length > 0) {
              toast.error(
                `${reason ?? "Some files couldn't be attached."} Re-attach ${listNames(failed.map((entry) => entry.file.name))} from the item.`,
              );
            }
          }
          toast.success(`${created.key} created.`);
          // Straight to the new item rather than back to the list: whoever
          // just wrote it usually wants to keep going on it. The origin travels
          // with them, so the new item's back link still points at the board or
          // sprint the "New item" button was pressed on.
          router.push(
            withReturnTo(`${basePath}/backlog/${created.key}`, returnTo),
          );
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  function remove() {
    if (!item) return;
    startTransition(async () => {
      try {
        await deleteWorkItem({ workItemId: item.id });
        toast.success(`${item.key} deleted.`);
        // The item is gone, so the origin is the only place left to go — and it
        // is where the reader was standing anyway.
        router.push(returnTo ?? `${basePath}/backlog`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't delete that item.",
        );
      }
    });
  }

  const assist = readOnly
    ? undefined
    : {
        projectId,
        workItemId: item?.id,
        context: { summary: form.summary, typeName: selectedType?.name },
      };

  /**
   * A dropped file needs an item to belong to. In create mode there isn't one
   * yet, so drops are HELD here and uploaded by `submit` once the item has an
   * id — the alternative, writing bytes to the store against a row that may
   * never be written, is exactly how orphaned blobs happen.
   */
  const [staged, setStaged] = useState<StagedAttachment[]>([]);

  const uploader = useAttachmentUploader({
    workItemId: item?.id ?? null,
    canUpload: abilities.attach && !readOnly,
    // The list itself lives in the Attachments tab, which re-reads from the
    // server — so a drop anywhere on the form only has to trigger that read.
    onUploaded: () => router.refresh(),
    onStage: (files, fieldKey) => {
      setStaged((current) => {
        const room = MAX_ATTACHMENTS_PER_ITEM - current.length;
        if (room <= 0) {
          toast.error(
            `You can attach at most ${MAX_ATTACHMENTS_PER_ITEM} files.`,
          );
          return current;
        }
        if (files.length > room) {
          toast.error(
            `Only the first ${room} of those fit — the limit is ${MAX_ATTACHMENTS_PER_ITEM}.`,
          );
        }
        return [
          ...current,
          ...files.slice(0, room).map((file) => ({
            id: crypto.randomUUID(),
            file,
            fieldKey,
          })),
        ];
      });
      toast.success(
        files.length === 1
          ? `${files[0].name} will be attached when you create the item.`
          : `${files.length} files will be attached when you create the item.`,
      );
    },
  });

  /** The attach prop for a prose block, or undefined when drops are off. */
  function proseAttach(fieldKey: ProseKey) {
    if (!uploader.enabled) return undefined;
    return {
      fieldKey,
      fieldLabel: WORK_ITEM_ATTACHMENT_FIELD_LABELS[fieldKey] ?? fieldKey,
      uploader,
    };
  }

  /** The attach prop for a custom field — the field's own id is the key. */
  const customAttach = uploader.enabled ? { uploader } : undefined;

  return (
    <div className="flex flex-col gap-6">
      {mode === "create" && !readOnly ? (
        <AiDraftCard onDraft={applyDraft} projectId={projectId} />
      ) : null}

      {/* min-w-0 the whole way down: an unbroken URL in a custom field would
          otherwise widen the grid track and push the sidebar off screen. */}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column: the content card plus ITS action bar — Save/Cancel
            govern only this column; the sidebar saves itself. */}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-card">
            <AttachmentDropzone
              fieldKey="summary"
              fieldLabel="Name"
              uploader={uploader}
            >
              <Field>
                <FieldLabel className="items-center" htmlFor="item-summary">
                  <IconClipboardText
                    className="size-4 text-brand"
                    aria-hidden
                  />
                  Name
                </FieldLabel>
                <Input
                  id="item-summary"
                  value={form.summary}
                  disabled={readOnly}
                  onChange={(event) => set("summary", event.target.value)}
                  placeholder="As a user, I can…"
                />
              </Field>
            </AttachmentDropzone>

            <RichTextField
              assist={assist}
              members={members}
              icon={<IconNotes className="size-4 text-chart-1" />}
              attach={proseAttach("description")}
              id="item-description"
              key={`item-description-${revisions.description ?? 0}`}
              label="Description"
              minHeight="min-h-48"
              value={form.description}
              disabled={readOnly}
              onChange={(markdown) => set("description", markdown)}
              placeholder="The context: what this is, who it's for, why now."
            />

            <RichTextField
              assist={assist}
              members={members}
              icon={<IconCircleCheck className="size-4 text-success" />}
              attach={proseAttach("acceptanceCriteria")}
              id="item-acceptance"
              key={`item-acceptance-${revisions.acceptanceCriteria ?? 0}`}
              label="Acceptance criteria"
              minHeight="min-h-36"
              value={form.acceptanceCriteria}
              disabled={readOnly}
              onChange={(markdown) => set("acceptanceCriteria", markdown)}
              placeholder={"Given …"}
              description="What has to be true for this specific item to be accepted."
            />

            <RichTextField
              assist={assist}
              members={members}
              icon={<IconCode className="size-4 text-chart-2" />}
              attach={proseAttach("technicalNotes")}
              id="item-technical"
              key={`item-technical-${revisions.technicalNotes ?? 0}`}
              label="Technical notes"
              minHeight="min-h-32"
              value={form.technicalNotes}
              disabled={readOnly}
              onChange={(markdown) => set("technicalNotes", markdown)}
              placeholder="Approach, constraints, migrations, links to designs or docs."
            />

            <RichTextField
              assist={assist}
              members={members}
              icon={<IconChecklist className="size-4 text-chart-3" />}
              attach={proseAttach("definitionOfDone")}
              id="item-dod"
              label="Definition of done"
              minHeight="min-h-24"
              value={form.definitionOfDone}
              disabled={readOnly}
              onChange={(markdown) => set("definitionOfDone", markdown)}
              placeholder="The team-wide bar: tests, docs, review, released."
              description="The standing quality bar, as opposed to this item's own acceptance criteria."
            />

            {/* Defect blocks follow the TYPE's tracksDefect flag, never its name
              — an org whose defect type is called "Incident" still gets them.
              Values are kept if the type later changes. */}
            {selectedType?.tracksDefect ? (
              <>
                <RichTextField
                  assist={assist}
                  members={members}
                  icon={<IconListNumbers className="size-4 text-destructive" />}
                  attach={proseAttach("stepsToReproduce")}
                  id="item-steps"
                  key={`item-steps-${revisions.stepsToReproduce ?? 0}`}
                  label="Steps to reproduce"
                  minHeight="min-h-32"
                  value={form.stepsToReproduce}
                  disabled={readOnly}
                  onChange={(markdown) => set("stepsToReproduce", markdown)}
                  placeholder={"1. …"}
                />
                {/* min-w-0 on the columns: a pasted stack trace inside either
                  editor would otherwise stretch the grid track. */}
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <RichTextField
                      assist={assist}
                      members={members}
                      icon={<IconTargetArrow className="size-4 text-success" />}
                      attach={proseAttach("expectedResult")}
                      id="item-expected"
                      key={`item-expected-${revisions.expectedResult ?? 0}`}
                      label="Expected"
                      minHeight="min-h-24"
                      value={form.expectedResult}
                      disabled={readOnly}
                      onChange={(markdown) => set("expectedResult", markdown)}
                    />
                  </div>
                  <div className="min-w-0">
                    <RichTextField
                      assist={assist}
                      members={members}
                      icon={
                        <IconAlertTriangle className="size-4 text-destructive" />
                      }
                      attach={proseAttach("actualResult")}
                      id="item-actual"
                      key={`item-actual-${revisions.actualResult ?? 0}`}
                      label="Actual"
                      minHeight="min-h-24"
                      value={form.actualResult}
                      disabled={readOnly}
                      onChange={(markdown) => set("actualResult", markdown)}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {mainFields.length > 0 ? (
              <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
                <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                  <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-chip text-chart-5">
                    <IconCategory className="size-4" aria-hidden />
                  </span>
                  {selectedType ? `${selectedType.name} fields` : "More fields"}
                </h2>
                {mainFields.map((field) => (
                  <CustomFieldInput
                    key={field.id}
                    assist={assist}
                    attach={customAttach}
                    field={field}
                    value={form.customFields[field.id]}
                    members={members}
                    disabled={readOnly}
                    onChange={(value) => setCustomField(field.id, value)}
                  />
                ))}
              </section>
            ) : null}

            {readOnly ? null : (
              <AiItemTools
                acceptanceCriteria={form.acceptanceCriteria}
                basePath={basePath}
                canCreateChildren={canHoldChildren}
                capacityUnit={capacityUnit}
                description={form.description}
                onAcceptanceCriteria={(markdown) => {
                  set("acceptanceCriteria", markdown);
                  reseed("acceptanceCriteria");
                }}
                onDefectFields={(fields) => {
                  setForm((current) => ({ ...current, ...fields }));
                  reseed("stepsToReproduce", "expectedResult", "actualResult");
                }}
                onPoints={(points) => set("points", String(points))}
                projectId={projectId}
                summary={form.summary}
                tracksDefect={selectedType?.tracksDefect ?? false}
                workItemId={item?.id ?? null}
              />
            )}
          </div>

          {/* Create mode only: what has been dropped but not yet uploaded, so
              "I attached that" and "it isn't saved yet" can't be confused. */}
          {staged.length > 0 ? (
            <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-border border-dashed p-4">
              <h2 className="flex items-center gap-2 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.09em]">
                <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-chip text-brand">
                  <IconPaperclip className="size-4" aria-hidden />
                </span>
                Attaching on create ({staged.length})
              </h2>
              <ul className="flex flex-col gap-1">
                {staged.map((entry) => (
                  <li
                    className="flex min-w-0 items-center gap-2 text-sm"
                    key={entry.id}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entry.file.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {formatBytes(entry.file.size)}
                      {entry.fieldKey
                        ? ` · ${WORK_ITEM_ATTACHMENT_FIELD_LABELS[entry.fieldKey] ?? "Field"}`
                        : ""}
                    </span>
                    <Button
                      aria-label={`Remove ${entry.file.name}`}
                      onClick={() =>
                        setStaged((current) =>
                          current.filter((row) => row.id !== entry.id),
                        )
                      }
                      size="icon-xs"
                      variant="ghost"
                    >
                      <IconX className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* The action bar sticks to the bottom of the viewport: on a long item
            the save button must not be a scroll away from what you just typed. */}
          {readOnly ? null : (
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-card p-3 shadow-float">
              {item && abilities.delete ? (
                <ConfirmDialog
                  title={`Delete ${item.key}?`}
                  description="Any sub-items move up to the top level rather than being deleted with it."
                  confirmLabel="Delete"
                  variant="destructive"
                  onConfirm={remove}
                  trigger={
                    <Button variant="destructive" className="mr-auto">
                      <IconTrash className="size-4" />
                      Delete
                    </Button>
                  }
                />
              ) : null}
              <Button
                variant="outline"
                onClick={() => router.push(returnTo ?? `${basePath}/backlog`)}
              >
                <IconX className="size-4" />
                Cancel
              </Button>
              <Button
                disabled={pending || !form.summary.trim() || !form.typeId}
                onClick={submit}
              >
                {pending ? (
                  <Spinner className="size-4" />
                ) : (
                  <IconDeviceFloppy className="size-4" />
                )}
                {item ? "Save changes" : "Create item"}
              </Button>
            </div>
          )}

          {activity}
        </div>

        {/* The sidebar's pickers carry the same marks the board and meta band
            use — type glyphs, status category icons, priority arrows, sprint
            state lozenges, member avatars — so a value reads without opening
            the menu. Colour stays on the small mark only (never fills the
            control), which keeps the column from turning into confetti. */}
        <aside className="flex min-w-0 flex-col gap-6 self-start rounded-lg border border-border bg-card p-5 shadow-card lg:sticky lg:top-4">
          {/* Not covered by Save/Cancel — say so, and say when a write is in
              flight. aria-live so the "Saving…" flip is announced, not seen. */}
          {autosaves ? (
            <p
              aria-live="polite"
              className="-mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              {metaSaving ? (
                <>
                  <Spinner className="size-3" aria-hidden />
                  Saving…
                </>
              ) : (
                "Changes here save automatically."
              )}
            </p>
          ) : null}
          <SideSection
            icon={<IconCategory className="size-4" aria-hidden />}
            title="Classification"
            tone="bg-chip text-brand"
          >
            <Field>
              <FieldLabel htmlFor="item-type">Type</FieldLabel>
              <TypeSelect
                id="item-type"
                value={form.typeId}
                disabled={readOnly}
                onChange={(next) => set("typeId", next)}
                types={types}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="item-status">Status</FieldLabel>
              <StatusSelect
                id="item-status"
                value={form.statusId}
                disabled={readOnly}
                onChange={(next) => set("statusId", next)}
                statuses={statuses}
              />
            </Field>
          </SideSection>

          <SideSection
            icon={<IconUserSquareRounded className="size-4" aria-hidden />}
            title="Ownership"
            tone="bg-chip text-chart-2"
          >
            <Field>
              <FieldLabel htmlFor="item-assignee">Assignee</FieldLabel>
              <MemberCombobox
                id="item-assignee"
                value={form.assigneeMemberId}
                disabled={readOnly}
                onChange={(next) => set("assigneeMemberId", next)}
                members={members}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="item-sprint">Sprint</FieldLabel>
              <SprintSelect
                id="item-sprint"
                value={form.sprintId}
                disabled={readOnly}
                onChange={(next) => set("sprintId", next)}
                sprints={sprints.filter(
                  (sprint) =>
                    sprint.state !== "completed" ||
                    sprint.id === item?.sprintId,
                )}
              />
            </Field>
          </SideSection>

          <SideSection
            icon={<IconChartBar className="size-4" aria-hidden />}
            title="Prioritisation"
            tone="bg-chip text-chart-3"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="item-priority">Priority</FieldLabel>
                <PrioritySelect
                  id="item-priority"
                  value={form.priority}
                  disabled={readOnly}
                  onChange={(next) => set("priority", next)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="item-points">Estimated effort</FieldLabel>
                <Input
                  id="item-points"
                  type="number"
                  min={0}
                  step="0.5"
                  className="tabular-nums"
                  value={form.points}
                  disabled={readOnly}
                  onChange={(event) => set("points", event.target.value)}
                  // An empty box on a parent is not "no estimate" — it is the
                  // children's sum. Showing it as the placeholder is what makes
                  // typing here legible as the OVERRIDE it is.
                  placeholder={
                    rolledEstimate === null
                      ? "Unestimated"
                      : `${rolledEstimate} from children`
                  }
                />
                {rolledEstimate !== null && form.points !== "" ? (
                  <FieldDescription>
                    Overrides the {rolledEstimate} rolled up from this item's
                    children. Clear the box to go back to the roll-up.
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="item-actual-efforts">
                  Actual effort
                </FieldLabel>
                <Input
                  id="item-actual-efforts"
                  type="number"
                  min={0}
                  step="0.25"
                  className="tabular-nums"
                  value={form.actualEfforts}
                  disabled={readOnly || form.points === ""}
                  onChange={(event) => set("actualEfforts", event.target.value)}
                  placeholder="Time spent"
                />
                <FieldDescription>
                  {form.points === ""
                    ? "Set estimated efforts to record time spent."
                    : "Hours recorded for effort reporting and estimation accuracy."}
                </FieldDescription>
              </Field>
            </div>

            {/* Value and risk are unset by default — "nobody has assessed this"
                is a real answer, and a default would claim otherwise. */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="item-value">Business value</FieldLabel>
                <ValueLevelSelect
                  id="item-value"
                  kind="value"
                  value={form.businessValue}
                  disabled={readOnly}
                  onChange={(next) => set("businessValue", next)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="item-risk">Risk</FieldLabel>
                <ValueLevelSelect
                  id="item-risk"
                  kind="risk"
                  value={form.riskLevel}
                  disabled={readOnly}
                  onChange={(next) => set("riskLevel", next)}
                />
              </Field>
            </div>
          </SideSection>

          <SideSection
            icon={<IconCalendarEvent className="size-4" aria-hidden />}
            title="Schedule"
            tone="bg-chip text-warning"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="item-start">Starts</FieldLabel>
                <Input
                  id="item-start"
                  type="date"
                  className="tabular-nums"
                  value={form.startDate}
                  disabled={readOnly}
                  onChange={(event) => set("startDate", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="item-due">Due</FieldLabel>
                <Input
                  id="item-due"
                  type="date"
                  className="tabular-nums"
                  value={form.dueDate}
                  min={form.startDate || undefined}
                  disabled={readOnly}
                  onChange={(event) => set("dueDate", event.target.value)}
                />
              </Field>
            </div>
          </SideSection>

          <SideSection
            icon={<IconSitemap className="size-4" aria-hidden />}
            title="Relations"
            tone="bg-chip text-chart-5"
          >
            {/* The hierarchy panel REPLACES this section's parent picker rather
                than joining it: two controls for one fact would disagree about
                whether the change autosaves, and only the panel can adopt a
                child. It only exists once the item does, so create mode still
                gets the picker. */}
            {relations ?? (
              <Field>
                <FieldLabel htmlFor="item-parent">Parent</FieldLabel>
                {parentCandidates.length === 0 ? (
                  <p className="flex h-8 items-center rounded-md border border-input border-dashed px-3 text-sm text-muted-foreground">
                    Nothing can hold this type
                  </p>
                ) : (
                  <ParentCombobox
                    id="item-parent"
                    value={form.parentId}
                    disabled={readOnly}
                    onChange={(next) => set("parentId", next)}
                    candidates={parentCandidates}
                    types={types}
                  />
                )}
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="item-labels">Labels</FieldLabel>
              <LabelsTagPicker
                id="item-labels"
                value={form.labels}
                suggestions={labelSuggestions}
                disabled={readOnly}
                onChange={(next) => set("labels", next)}
              />
            </Field>
          </SideSection>

          {/* Custom fields whose org put them with the meta rather than the
              content. Divided off so they don't read as built-ins. */}
          {sideFields.length > 0 ? (
            <SideSection
              icon={<IconCategory className="size-4" aria-hidden />}
              title="More fields"
              tone="bg-chip text-muted-foreground"
            >
              {sideFields.map((field) => (
                <CustomFieldInput
                  key={field.id}
                  assist={assist}
                  attach={customAttach}
                  field={field}
                  value={form.customFields[field.id]}
                  members={members}
                  disabled={readOnly}
                  onChange={(value) => setCustomField(field.id, value)}
                />
              ))}
            </SideSection>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/**
 * Sends the files a create-mode form was holding, now that the item exists.
 *
 * Grouped by the field they were dropped on, because that is what the route
 * takes per request — one request per field rather than one per file keeps a
 * six-screenshot drop to a single round trip. Failures are reported and then
 * swallowed: the item is already created, and throwing here would leave the
 * caller on a form for an item that exists.
 */
/** A drop held in create mode, waiting for an item id to belong to. */
type StagedAttachment = { id: string; file: File; fieldKey: string | null };

/** "a.log", "a.log and b.log", "a.log, b.log and 3 more" — never a wall of names. */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Sends the held drops now that the item exists: one request per field, split
 * into request-sized batches (the per-item cap is five times what one request
 * may carry, so a legitimate 20-file stage is two requests, not one 413).
 *
 * Returns what did NOT land, so the caller can say which files to re-add rather
 * than clearing the staged list on the assumption everything worked.
 */
async function uploadStagedAttachments(
  workItemId: string,
  staged: StagedAttachment[],
): Promise<{ failed: StagedAttachment[]; reason: string | null }> {
  const groups = new Map<string, StagedAttachment[]>();
  for (const entry of staged) {
    const key = entry.fieldKey ?? "";
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  const failed: StagedAttachment[] = [];
  let reason: string | null = null;

  for (const [fieldKey, entries] of groups) {
    for (const batch of batchedForUpload(
      entries,
      MAX_ATTACHMENTS_PER_REQUEST,
    )) {
      const body = new FormData();
      for (const entry of batch) body.append("file", entry.file);
      if (fieldKey) body.append("fieldKey", fieldKey);

      try {
        const response = await fetch(
          `/api/work-items/${workItemId}/attachments`,
          { body, method: "POST" },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          reason ??= payload?.error ?? null;
          failed.push(...batch);
        }
      } catch {
        reason ??= "Couldn't reach the server.";
        failed.push(...batch);
      }
    }
  }

  return { failed, reason };
}

/**
 * One named block of the sidebar: a tinted icon square, an uppercase title, a
 * hairline, then its controls. Purely presentational — the grouping is what
 * makes a 14-control sidebar scannable, not a `<fieldset>` semantic, so it
 * stays a plain section rather than claiming a form grouping it doesn't own.
 */
function SideSection({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 border-border border-b pb-2 font-bold text-[11px] text-muted-foreground uppercase tracking-[0.09em]">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-[8px]",
            tone,
          )}
        >
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
