// Custom work item fields: what a field type accepts, and how one stored value
// becomes text.
//
// Client-safe (no db/server imports) on purpose — the field editor, the item
// dialog and the server action must agree on exactly one definition of "is this
// a valid value for this field", or the form will offer something the action
// refuses.

import type {
  WorkItemFieldPlacement,
  WorkItemFieldType,
} from "@/db/schema/work-items";

export type WorkItemFieldOption = { value: string; label: string };

export type WorkItemFieldDefinition = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  fieldType: WorkItemFieldType;
  options: WorkItemFieldOption[];
  /** Empty = every type in the organization. */
  appliesToTypeIds: string[];
  isRequired: boolean;
  helpText: string | null;
  /** Which half of the item form the input renders in. */
  placement: WorkItemFieldPlacement;
  position: number;
};

/** Field types whose value is prose worth feeding into the item's embedding. */
const PROSE_FIELD_TYPES = new Set<WorkItemFieldType>(["text", "long_text"]);

export function isProseField(fieldType: WorkItemFieldType): boolean {
  return PROSE_FIELD_TYPES.has(fieldType);
}

export function fieldNeedsOptions(fieldType: WorkItemFieldType): boolean {
  return fieldType === "single_select" || fieldType === "multi_select";
}

/** The fields that apply to one work item type, in the org's chosen order. */
export function fieldsForType(
  fields: WorkItemFieldDefinition[],
  typeId: string | null,
): WorkItemFieldDefinition[] {
  return fields
    .filter(
      (field) =>
        field.appliesToTypeIds.length === 0 ||
        (typeId !== null && field.appliesToTypeIds.includes(typeId)),
    )
    .sort((left, right) => left.position - right.position);
}

/** The subset of `fieldsForType` that renders in one half of the form. */
export function fieldsForPlacement(
  fields: WorkItemFieldDefinition[],
  placement: WorkItemFieldPlacement,
): WorkItemFieldDefinition[] {
  return fields.filter((field) => field.placement === placement);
}

export type FieldValueError = { fieldId: string; message: string };

/**
 * Coerces one submitted value into what the field type stores, or returns an
 * error. Returns `null` for "unset" — an empty string, an empty array and an
 * absent key all mean the same thing, and storing three different flavours of
 * empty is how a "required" check ends up passing on a blank.
 *
 * Runs on BOTH sides: the dialog uses it to disable Create, the server action
 * uses it as the authority. Never trust the client's copy of the answer.
 */
export function coerceFieldValue(
  field: WorkItemFieldDefinition,
  input: unknown,
): { value: unknown; text: string | null } | { error: string } {
  if (input === undefined || input === null || input === "") {
    return { value: null, text: null };
  }

  switch (field.fieldType) {
    case "text":
    case "long_text": {
      if (typeof input !== "string") return { error: "Expected text." };
      const trimmed = input.trim();
      if (!trimmed) return { value: null, text: null };
      if (trimmed.length > 20_000) return { error: "That's too long." };
      return { value: trimmed, text: trimmed };
    }
    case "url": {
      if (typeof input !== "string") return { error: "Expected a link." };
      const trimmed = input.trim();
      if (!trimmed) return { value: null, text: null };
      // Parsed rather than regexed, and restricted to http(s): a stored
      // `javascript:` URL would become a click-through in the UI.
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return { error: "Enter a full link, including https://." };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { error: "Only http and https links are allowed." };
      }
      return { value: parsed.toString(), text: parsed.toString() };
    }
    case "number": {
      const numeric = typeof input === "number" ? input : Number(input);
      if (!Number.isFinite(numeric)) return { error: "Enter a number." };
      return { value: numeric, text: String(numeric) };
    }
    case "date": {
      if (typeof input !== "string") return { error: "Expected a date." };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return { error: "Enter a date as YYYY-MM-DD." };
      }
      return { value: input, text: input };
    }
    case "checkbox": {
      const checked = input === true || input === "true";
      // An unticked box is a real answer ("no"), not an unset field, so this
      // stores false rather than collapsing to null.
      return { value: checked, text: checked ? "Yes" : "No" };
    }
    case "single_select": {
      if (typeof input !== "string") return { error: "Pick an option." };
      const option = field.options.find((choice) => choice.value === input);
      if (!option) return { error: "That option isn't on this field." };
      return { value: option.value, text: option.label };
    }
    case "multi_select": {
      const list = Array.isArray(input) ? input : [input];
      const chosen: WorkItemFieldOption[] = [];
      for (const entry of list) {
        const option = field.options.find((choice) => choice.value === entry);
        if (!option) return { error: "That option isn't on this field." };
        if (!chosen.some((existing) => existing.value === option.value)) {
          chosen.push(option);
        }
      }
      if (chosen.length === 0) return { value: null, text: null };
      return {
        value: chosen.map((option) => option.value),
        text: chosen.map((option) => option.label).join(", "),
      };
    }
    case "user": {
      if (typeof input !== "string") return { error: "Pick a person." };
      // The member id is checked against the organization by the server action
      // — this side only knows the shape.
      return { value: input, text: null };
    }
    default:
      return { error: "Unknown field type." };
  }
}

/** Which required fields are still blank, for the form and for the action. */
export function missingRequiredFields(
  fields: WorkItemFieldDefinition[],
  values: Record<string, unknown>,
): WorkItemFieldDefinition[] {
  return fields.filter((field) => {
    if (!field.isRequired) return false;
    const coerced = coerceFieldValue(field, values[field.id]);
    if ("error" in coerced) return true;
    return coerced.value === null;
  });
}

/** Same rule as slugifyRoleKey/slugifyTypeKey: the server always re-derives. */
export function slugifyFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Renders a stored value for a read-only surface (table cells, cards). */
export function formatFieldValue(
  field: WorkItemFieldDefinition,
  value: unknown,
  resolveUser?: (memberId: string) => string | undefined,
): string {
  if (value === null || value === undefined) return "—";
  switch (field.fieldType) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "single_select":
      return (
        field.options.find((option) => option.value === value)?.label ??
        String(value)
      );
    case "multi_select":
      return Array.isArray(value)
        ? value
            .map(
              (entry) =>
                field.options.find((option) => option.value === entry)?.label ??
                String(entry),
            )
            .join(", ")
        : String(value);
    case "user":
      return resolveUser?.(String(value)) ?? "Unknown person";
    default:
      return String(value);
  }
}
