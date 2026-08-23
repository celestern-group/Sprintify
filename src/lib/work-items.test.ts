import { describe, expect, it } from "vitest";
import {
  createWorkItemSchema,
  createWorkItemTypeSchema,
} from "@/lib/validation/work-items";
import { canParent, SEED_WORK_ITEM_TYPES } from "./work-items";

describe("work item hierarchy mapping", () => {
  it("assigns each seeded type a consecutive numeric level", () => {
    expect(
      Object.fromEntries(
        SEED_WORK_ITEM_TYPES.map((type) => [type.name, type.hierarchyLevel]),
      ),
    ).toEqual({
      Epic: 0,
      Feature: 1,
      Story: 2,
      Task: 3,
      Bug: 4,
      "Sub-task": 5,
    });
  });

  it("supports additional non-negative levels while preserving parent order", () => {
    expect(
      createWorkItemTypeSchema.safeParse({
        organizationId: "00000000-0000-4000-8000-000000000001",
        name: "Checklist item",
        hierarchyLevel: 4,
      }).success,
    ).toBe(true);
    expect(canParent(0, 1)).toBe(true);
    expect(canParent(5, 6)).toBe(true);
    expect(canParent(1, 0)).toBe(false);
  });
});

describe("work item effort validation", () => {
  const baseItem = {
    projectId: "00000000-0000-4000-8000-000000000001",
    typeId: "00000000-0000-4000-8000-000000000002",
    summary: "Track implementation time",
  };

  it("accepts decimal actual hours alongside an estimate", () => {
    expect(
      createWorkItemSchema.safeParse({
        ...baseItem,
        points: 4,
        actualEfforts: 3.5,
      }).success,
    ).toBe(true);
  });

  it("refuses negative actual hours", () => {
    expect(
      createWorkItemSchema.safeParse({ ...baseItem, actualEfforts: -0.25 })
        .success,
    ).toBe(false);
  });
});
