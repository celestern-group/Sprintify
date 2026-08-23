"use client";

import {
  AttachmentDropzone,
  type AttachmentUploader,
} from "@/components/app/backlog/attachment-dropzone";
import { MemberCombobox } from "@/components/app/backlog/field-controls";
import { RichTextField } from "@/components/app/backlog/rich-text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { BacklogMemberRow } from "@/lib/actions/work-items";
import { cn } from "@/lib/utils";
import type { WorkItemFieldDefinition } from "@/lib/work-item-fields";

/**
 * One custom field, plus its drop target.
 *
 * A file dropped on any custom field is attached to the item and filed under
 * THAT field. Long text is the exception to the wrapper: it is a prose editor,
 * so the drop is handled inside it (where the caret is) and also writes a link
 * — wrapping it here would swallow the event in the capture phase before the
 * editor ever saw it.
 */
export function CustomFieldInput({
  attach,
  ...props
}: Omit<React.ComponentProps<typeof CustomFieldControl>, "attach"> & {
  /** Absent = this field takes no drops (read-only, or no item yet). */
  attach?: { uploader: AttachmentUploader };
}) {
  if (!attach) return <CustomFieldControl {...props} />;

  if (props.field.fieldType === "long_text") {
    return (
      <CustomFieldControl
        {...props}
        attach={{
          fieldKey: props.field.id,
          fieldLabel: props.field.label,
          uploader: attach.uploader,
        }}
      />
    );
  }

  return (
    <AttachmentDropzone
      fieldKey={props.field.id}
      fieldLabel={props.field.label}
      uploader={attach.uploader}
    >
      <CustomFieldControl {...props} />
    </AttachmentDropzone>
  );
}

/**
 * One custom field, rendered from its definition.
 *
 * The value is passed around as `unknown` on purpose: what a field holds is
 * decided by its type at the definition, and the one place that interprets it
 * is coerceFieldValue (src/lib/work-item-fields.ts), which both this form and
 * the server action share. Narrowing here would fork that rule.
 */
function CustomFieldControl({
  field,
  value,
  members,
  disabled,
  onChange,
  assist,
  attach,
}: {
  field: WorkItemFieldDefinition;
  value: unknown;
  members: BacklogMemberRow[];
  disabled?: boolean;
  onChange: (value: unknown) => void;
  /** Forwarded to long-text fields only — the rest aren't prose. */
  assist?: {
    projectId: string;
    workItemId?: string | null;
    context?: { summary?: string; typeName?: string };
  };
  /** Forwarded to long-text fields only — see CustomFieldInput above. */
  attach?: {
    fieldKey: string;
    fieldLabel: string;
    uploader: AttachmentUploader;
  };
}) {
  const id = `custom-${field.id}`;
  const label = (
    <FieldLabel htmlFor={id}>
      {field.label}
      {field.isRequired ? (
        <span className="ml-1 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
      {field.isRequired ? <span className="sr-only"> (required)</span> : null}
    </FieldLabel>
  );
  const help = field.helpText ? (
    <FieldDescription>{field.helpText}</FieldDescription>
  ) : null;

  switch (field.fieldType) {
    // Long text is the one custom type that's a document rather than a value,
    // so it gets the same markdown editor as the built-in prose blocks.
    case "long_text":
      return (
        <RichTextField
          assist={assist}
          attach={attach}
          id={id}
          label={field.label}
          required={field.isRequired}
          description={field.helpText ?? undefined}
          minHeight="min-h-28"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(markdown) => onChange(markdown)}
        />
      );

    case "number":
      return (
        <Field>
          {label}
          <Input
            id={id}
            type="number"
            className="tabular-nums"
            disabled={disabled}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(event) =>
              onChange(event.target.value === "" ? null : event.target.value)
            }
          />
          {help}
        </Field>
      );

    case "date":
      return (
        <Field>
          {label}
          <Input
            id={id}
            type="date"
            className="tabular-nums"
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value || null)}
          />
          {help}
        </Field>
      );

    case "checkbox":
      return (
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            disabled={disabled}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <div className="flex flex-col">
            {label}
            {help}
          </div>
        </Field>
      );

    case "single_select":
      return (
        <Field>
          {label}
          <NativeSelect
            id={id}
            className="w-full"
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">Not set</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {help}
        </Field>
      );

    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field>
          {label}
          {/* Checkboxes rather than a multiple <select>: a native multi-select
              needs ctrl-click to add a second value, which people routinely
              lose their first choice to. */}
          <div className="flex flex-wrap gap-2">
            {field.options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={checked}
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((entry) => entry !== option.value)
                        : [...selected, option.value],
                    )
                  }
                  className={cn(
                    "rounded-[8px] px-2 py-1 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    checked
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-chip text-foreground",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {help}
        </Field>
      );
    }

    case "user":
      return (
        <Field>
          {label}
          <MemberCombobox
            id={id}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(next) => onChange(next || null)}
            members={members}
            unassignedLabel="Not set"
          />
          {help}
        </Field>
      );

    case "url":
      return (
        <Field>
          {label}
          <Input
            id={id}
            type="url"
            inputMode="url"
            placeholder="https://"
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value || null)}
          />
          {help}
        </Field>
      );

    default:
      return (
        <Field>
          {label}
          <Input
            id={id}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
        </Field>
      );
  }
}
