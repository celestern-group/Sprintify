import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

describe("extractJson", () => {
  it("returns a bare object untouched", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a ```json fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("unwraps an unlabelled fence", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("drops commentary before and after the object", () => {
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe(
      '{"a":1}',
    );
  });

  it("keeps a fenced code block that is INSIDE a string value", () => {
    const raw = '{"description":"Run ```pnpm build``` first"}';
    expect(JSON.parse(extractJson(raw))).toEqual({
      description: "Run ```pnpm build``` first",
    });
  });

  it("unwraps an outer fence around a value that has its own fence", () => {
    const raw = '```json\n{"notes":"```ts\\nconst a = 1\\n```"}\n```';
    expect(JSON.parse(extractJson(raw))).toEqual({
      notes: "```ts\nconst a = 1\n```",
    });
  });

  it("handles a top-level array", () => {
    expect(extractJson("here: [1,2]")).toBe("[1,2]");
  });

  it("returns the body unchanged when there is no JSON at all", () => {
    expect(extractJson("I can't do that")).toBe("I can't do that");
  });
});
