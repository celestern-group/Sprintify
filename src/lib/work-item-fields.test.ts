import { describe, expect, it } from "vitest";
import {
  coerceFieldValue,
  fieldsForPlacement,
  fieldsForType,
  missingRequiredFields,
  type WorkItemFieldDefinition,
} from "./work-item-fields";

function field(
  overrides: Partial<WorkItemFieldDefinition> = {},
): WorkItemFieldDefinition {
  return {
    id: "field-1",
    key: "severity",
    label: "Severity",
    description: null,
    fieldType: "text",
    options: [],
    appliesToTypeIds: [],
    isRequired: false,
    helpText: null,
    placement: "main",
    position: 0,
    ...overrides,
  };
}

describe("coerceFieldValue", () => {
  it("treats blank input as unset", () => {
    expect(coerceFieldValue(field(), "")).toEqual({ value: null, text: null });
    expect(coerceFieldValue(field(), "   ")).toEqual({
      value: null,
      text: null,
    });
    expect(coerceFieldValue(field(), undefined)).toEqual({
      value: null,
      text: null,
    });
  });

  it("keeps an unticked checkbox as a real answer, not unset", () => {
    expect(coerceFieldValue(field({ fieldType: "checkbox" }), false)).toEqual({
      value: false,
      text: "No",
    });
  });

  it("rejects a non-http link", () => {
    const url = field({ fieldType: "url" });
    expect(coerceFieldValue(url, "javascript:alert(1)")).toHaveProperty(
      "error",
    );
    expect(coerceFieldValue(url, "not a url")).toHaveProperty("error");
    expect(coerceFieldValue(url, "https://example.com/x")).toEqual({
      value: "https://example.com/x",
      text: "https://example.com/x",
    });
  });

  it("rejects an option that isn't on the field", () => {
    const select = field({
      fieldType: "single_select",
      options: [{ value: "major", label: "Major" }],
    });
    expect(coerceFieldValue(select, "minor")).toHaveProperty("error");
    expect(coerceFieldValue(select, "major")).toEqual({
      value: "major",
      text: "Major",
    });
  });

  it("dedupes multi-select and renders labels for search", () => {
    const multi = field({
      fieldType: "multi_select",
      options: [
        { value: "api", label: "API" },
        { value: "web", label: "Web" },
      ],
    });
    expect(coerceFieldValue(multi, ["api", "api", "web"])).toEqual({
      value: ["api", "web"],
      text: "API, Web",
    });
  });

  it("rejects a number that isn't one", () => {
    const number = field({ fieldType: "number" });
    expect(coerceFieldValue(number, "abc")).toHaveProperty("error");
    expect(coerceFieldValue(number, "3.5")).toEqual({
      value: 3.5,
      text: "3.5",
    });
  });

  it("rejects a malformed date", () => {
    const date = field({ fieldType: "date" });
    expect(coerceFieldValue(date, "01/02/2026")).toHaveProperty("error");
    expect(coerceFieldValue(date, "2026-02-01")).toEqual({
      value: "2026-02-01",
      text: "2026-02-01",
    });
  });
});

describe("fieldsForType", () => {
  it("includes unpinned fields for every type and honours the pin", () => {
    const all = field({ id: "all", appliesToTypeIds: [], position: 1 });
    const bugOnly = field({
      id: "bug-only",
      appliesToTypeIds: ["type-bug"],
      position: 0,
    });

    expect(fieldsForType([all, bugOnly], "type-bug").map((f) => f.id)).toEqual([
      "bug-only",
      "all",
    ]);
    expect(
      fieldsForType([all, bugOnly], "type-story").map((f) => f.id),
    ).toEqual(["all"]);
  });
});

describe("fieldsForPlacement", () => {
  it("splits the active fields into the two halves of the form", () => {
    const content = field({ id: "content", placement: "main" });
    const meta = field({ id: "meta", placement: "side" });

    expect(
      fieldsForPlacement([content, meta], "main").map((f) => f.id),
    ).toEqual(["content"]);
    expect(
      fieldsForPlacement([content, meta], "side").map((f) => f.id),
    ).toEqual(["meta"]);
  });
});

describe("missingRequiredFields", () => {
  it("counts a blank required field as missing", () => {
    const required = field({ isRequired: true });
    expect(missingRequiredFields([required], {})).toHaveLength(1);
    expect(missingRequiredFields([required], { "field-1": "x" })).toHaveLength(
      0,
    );
  });

  it("counts an invalid value as missing rather than letting it through", () => {
    const required = field({
      isRequired: true,
      fieldType: "single_select",
      options: [{ value: "a", label: "A" }],
    });
    expect(
      missingRequiredFields([required], { "field-1": "nope" }),
    ).toHaveLength(1);
  });

  it("accepts an unticked required checkbox — false is an answer", () => {
    const required = field({ isRequired: true, fieldType: "checkbox" });
    expect(
      missingRequiredFields([required], { "field-1": false }),
    ).toHaveLength(0);
  });
});
