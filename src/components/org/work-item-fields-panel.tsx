"use client";

import {
  IconArrowDown,
  IconArrowUp,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type {
  WorkItemFieldPlacement,
  WorkItemFieldType,
} from "@/db/schema/work-items";
import {
  WORK_ITEM_FIELD_PLACEMENT_LABELS,
  WORK_ITEM_FIELD_PLACEMENTS,
  WORK_ITEM_FIELD_TYPE_LABELS,
  WORK_ITEM_FIELD_TYPES,
} from "@/db/schema/work-items";
import type { ManagedWorkItemField } from "@/lib/actions/work-item-fields";
import {
  createWorkItemField,
  deleteWorkItemField,
  reorderWorkItemFields,
  updateWorkItemField,
} from "@/lib/actions/work-item-fields";
import type { ManagedWorkItemType } from "@/lib/actions/work-item-types";
import { cn } from "@/lib/utils";
import { fieldNeedsOptions, slugifyFieldKey } from "@/lib/work-item-fields";

type Draft = {
  label: string;
  description: string;
  fieldType: WorkItemFieldType;
  optionsText: string;
  appliesToTypeIds: string[];
  isRequired: boolean;
  helpText: string;
  placement: WorkItemFieldPlacement;
};

const EMPTY: Draft = {
  label: "",
  description: "",
  fieldType: "text",
  optionsText: "",
  appliesToTypeIds: [],
  isRequired: false,
  helpText: "",
  placement: "main",
};

/**
 * The organization's custom field catalog — everything the built-in item form
 * doesn't already cover (Severity, Component, Customer, a compliance flag).
 *
 * Fields are org-scoped and optionally pinned to work item types, so "Severity"
 * can exist once and appear only on defects. Reachable by an org owner/admin
 * from /manage-org, and by a platform admin from /admin/organizations/[id] —
 * one table, two doors.
 */
export function WorkItemFieldsPanel({
  organizationId,
  fields,
  types,
}: {
  organizationId: string;
  fields: ManagedWorkItemField[];
  types: ManagedWorkItemType[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedWorkItemField | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(field: ManagedWorkItemField) {
    setEditing(field);
    setDraft({
      label: field.label,
      description: field.description ?? "",
      fieldType: field.fieldType,
      optionsText: field.options.map((option) => option.label).join("\n"),
      appliesToTypeIds: [...field.appliesToTypeIds],
      isRequired: field.isRequired,
      helpText: field.helpText ?? "",
      placement: field.placement,
    });
    setOpen(true);
  }

  function save() {
    // One option per line: a comma-separated box makes "Blocked, needs input"
    // impossible to enter. The value is slugified from the label so an export
    // stays stable while the label can be renamed.
    const options = draft.optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label) => ({ value: slugifyFieldKey(label), label }));

    run(
      async () => {
        const payload = {
          organizationId,
          label: draft.label,
          description: draft.description || undefined,
          fieldType: draft.fieldType,
          options,
          appliesToTypeIds: draft.appliesToTypeIds,
          isRequired: draft.isRequired,
          helpText: draft.helpText || undefined,
          placement: draft.placement,
        };
        if (editing) {
          await updateWorkItemField({ fieldId: editing.id, ...payload });
        } else {
          await createWorkItemField(payload);
        }
        setOpen(false);
      },
      editing ? "Field saved." : "Field created.",
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...fields];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(
      () =>
        reorderWorkItemFields({
          organizationId,
          fieldIds: next.map((field) => field.id),
        }),
      "Field order saved.",
    );
  }

  const typeNames = new Map(types.map((type) => [type.id, type.name]));

  return (
    <>
      <SectionCard
        title="Custom fields"
        description="Extra fields on every work item form. Pin one to specific types, or leave it on all of them."
        action={
          <Button size="sm" onClick={openCreate}>
            <IconPlus className="size-4" />
            New field
          </Button>
        }
        bodyClassName="overflow-x-auto"
      >
        {fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No custom fields yet. The built-in form already covers name,
            description, acceptance criteria, technical notes and definition of
            done — add a field for what this organization tracks beyond that.
          </p>
        ) : (
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                <th scope="col" className="py-2 pr-3">
                  Field
                </th>
                <th scope="col" className="py-2 pr-3">
                  Type
                </th>
                <th scope="col" className="py-2 pr-3">
                  Shown in
                </th>
                <th scope="col" className="py-2 pr-3">
                  Applies to
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Values
                </th>
                <th scope="col" className="py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fields.map((field, index) => (
                <tr key={field.id}>
                  <th scope="row" className="py-2.5 pr-3 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{field.label}</span>
                      {field.isRequired ? (
                        <Badge variant="warning">Required</Badge>
                      ) : null}
                    </span>
                    {field.description ? (
                      <span className="mt-0.5 block max-w-lg truncate text-xs font-normal text-muted-foreground">
                        {field.description}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {WORK_ITEM_FIELD_TYPE_LABELS[field.fieldType]}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {WORK_ITEM_FIELD_PLACEMENT_LABELS[field.placement]}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {field.appliesToTypeIds.length === 0
                      ? "All types"
                      : field.appliesToTypeIds
                          .map((id) => typeNames.get(id) ?? "Unknown")
                          .join(", ")}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                    {field.valueCount}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending || index === 0}
                        aria-label={`Move ${field.label} up`}
                        onClick={() => move(index, -1)}
                      >
                        <IconArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending || index === fields.length - 1}
                        aria-label={`Move ${field.label} down`}
                        onClick={() => move(index, 1)}
                      >
                        <IconArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${field.label}`}
                        onClick={() => openEdit(field)}
                      >
                        <IconPencil className="size-4" />
                      </Button>
                      <ConfirmDialog
                        title={`Delete ${field.label}?`}
                        description={
                          field.valueCount > 0
                            ? `${field.valueCount} item${field.valueCount === 1 ? "" : "s"} have a value for this field. Deleting it discards them.`
                            : "Nothing has a value for this field yet."
                        }
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() =>
                          run(
                            () =>
                              deleteWorkItemField({
                                organizationId,
                                fieldId: field.id,
                              }),
                            "Field deleted.",
                          )
                        }
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${field.label}`}
                          >
                            <IconTrash className="size-4" />
                          </Button>
                        }
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Wider than the default md: this form carries an options list, a
            type-pin picker and three text blocks, and at 28rem every one of
            them reads as a narrow column with its help text wrapping twice. */}
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? editing.label : "New field"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The key stays as it was — exports and integrations map onto it."
                : "The key is derived from the label and can't be changed later."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="field-label">Label</FieldLabel>
                <Input
                  id="field-label"
                  value={draft.label}
                  onChange={(event) =>
                    setDraft({ ...draft, label: event.target.value })
                  }
                />
              </Field>

              {/* Two selects, one row: both are one-line choices, and the
                  extra width is better spent than on two half-empty rows. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="field-type">Type</FieldLabel>
                  <NativeSelect
                    id="field-type"
                    className="w-full"
                    value={draft.fieldType}
                    disabled={Boolean(editing && editing.valueCount > 0)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        fieldType: event.target.value as WorkItemFieldType,
                      })
                    }
                  >
                    {WORK_ITEM_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {WORK_ITEM_FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </NativeSelect>
                  {editing && editing.valueCount > 0 ? (
                    <FieldDescription>
                      Locked: {editing.valueCount} stored value
                      {editing.valueCount === 1 ? "" : "s"} would be
                      reinterpreted as something else. Create a new field
                      instead.
                    </FieldDescription>
                  ) : null}
                </Field>

                {/* Where the input lands on the item form. The main column is
                    for what the item IS, the side panel for short values people
                    scan — only whoever defines the field knows which it is. */}
                <Field>
                  <FieldLabel htmlFor="field-placement">Shown in</FieldLabel>
                  <NativeSelect
                    id="field-placement"
                    className="w-full"
                    value={draft.placement}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        placement: event.target.value as WorkItemFieldPlacement,
                      })
                    }
                  >
                    {WORK_ITEM_FIELD_PLACEMENTS.map((placement) => (
                      <option key={placement} value={placement}>
                        {WORK_ITEM_FIELD_PLACEMENT_LABELS[placement]}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {draft.placement === "main"
                      ? "Under the item's content, alongside description and acceptance criteria."
                      : "In the meta sidebar, alongside status, assignee and dates. Best for short values."}
                  </FieldDescription>
                </Field>
              </div>

              {fieldNeedsOptions(draft.fieldType) ? (
                <Field>
                  <FieldLabel htmlFor="field-options">Options</FieldLabel>
                  <Textarea
                    id="field-options"
                    rows={4}
                    value={draft.optionsText}
                    onChange={(event) =>
                      setDraft({ ...draft, optionsText: event.target.value })
                    }
                    placeholder={"Blocker\nMajor\nMinor"}
                  />
                  <FieldDescription>One per line.</FieldDescription>
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="field-help">Help text</FieldLabel>
                <Input
                  id="field-help"
                  value={draft.helpText}
                  onChange={(event) =>
                    setDraft({ ...draft, helpText: event.target.value })
                  }
                  placeholder="Shown under the input on the item form."
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="field-description">Description</FieldLabel>
                <Textarea
                  id="field-description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  placeholder="What this field is for — for whoever configures it later."
                />
              </Field>

              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-sm font-semibold">
                  Applies to
                </legend>
                <p className="text-xs text-muted-foreground">
                  Leave everything unticked for all types.
                </p>
                <div className="flex flex-wrap gap-2">
                  {types.map((type) => {
                    const checked = draft.appliesToTypeIds.includes(type.id);
                    return (
                      <button
                        key={type.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            appliesToTypeIds: checked
                              ? draft.appliesToTypeIds.filter(
                                  (id) => id !== type.id,
                                )
                              : [...draft.appliesToTypeIds, type.id],
                          })
                        }
                        className={cn(
                          "rounded-sm px-2 py-1 text-xs font-semibold transition-colors",
                          checked
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-chip text-foreground",
                        )}
                      >
                        {type.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Field orientation="horizontal">
                <Switch
                  id="field-required"
                  checked={draft.isRequired}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, isRequired: checked })
                  }
                />
                <FieldLabel htmlFor="field-required">
                  Required — an item can&apos;t be saved without it
                </FieldLabel>
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !draft.label.trim()} onClick={save}>
              {pending ? <Spinner className="size-4" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
