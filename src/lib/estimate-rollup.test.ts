import { describe, expect, it } from "vitest";
import {
  attributeEstimates,
  bucketEstimates,
  countUnestimated,
  type EstimateNode,
  effectiveEstimateOf,
  effectiveEstimates,
  sumEstimates,
} from "./estimate-rollup";

function node(
  id: string,
  parentId: string | null,
  points: number | null,
): EstimateNode {
  return { id, parentId, points };
}

describe("effectiveEstimates", () => {
  it("sums a parent's children when the parent has no estimate of its own", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];

    const epic = effectiveEstimateOf("epic", items);
    expect(epic.value).toBe(8);
    expect(epic.source).toBe("rollup");
    expect(epic.childCount).toBe(2);
  });

  it("uses the user's value and ignores children once the parent is set", () => {
    const items = [
      node("epic", null, 13),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];

    const epic = effectiveEstimateOf("epic", items);
    expect(epic.value).toBe(13);
    expect(epic.source).toBe("own");
  });

  it("leaves a childless item unestimated rather than zero", () => {
    const epic = effectiveEstimateOf("epic", [node("epic", null, null)]);
    expect(epic.value).toBeNull();
    expect(epic.source).toBe("own");
  });

  it("rolls up through grandchildren", () => {
    const items = [
      node("epic", null, null),
      node("story", "epic", null),
      node("task-1", "story", 2),
      node("task-2", "story", 2.5),
    ];

    expect(effectiveEstimateOf("story", items).value).toBe(4.5);
    expect(effectiveEstimateOf("epic", items).value).toBe(4.5);
  });

  it("stops rolling up at an overridden intermediate parent", () => {
    const items = [
      node("epic", null, null),
      node("story", "epic", 20),
      node("task", "story", 2),
    ];

    expect(effectiveEstimateOf("epic", items).value).toBe(20);
  });

  it("stays unestimated when no descendant carries a number", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", null),
      node("b", "epic", null),
    ];

    expect(effectiveEstimateOf("epic", items).value).toBeNull();
  });

  it("counts an estimated child as a contributor and skips unestimated ones", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", null),
    ];

    const epic = effectiveEstimateOf("epic", items);
    expect(epic.value).toBe(3);
    expect(epic.childCount).toBe(2);
    expect(epic.contributors).toBe(1);
  });

  it("keeps fractional sums to two decimals", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 0.1),
      node("b", "epic", 0.2),
    ];

    expect(effectiveEstimateOf("epic", items).value).toBe(0.3);
  });

  it("does not spin on a parent cycle", () => {
    const items = [node("a", "b", null), node("b", "a", null)];
    const estimates = effectiveEstimates(items);
    expect(estimates.get("a")?.value).toBeNull();
    expect(estimates.get("b")?.value).toBeNull();
  });
});

describe("sumEstimates", () => {
  it("counts a parent once instead of adding it to its children", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];

    expect(sumEstimates(items)).toBe(8);
  });

  it("counts the children when the parent is outside the set", () => {
    const all = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];
    const sprint = all.filter((item) => item.id !== "epic");

    expect(sumEstimates(sprint, all)).toBe(8);
  });

  it("lets a scheduled parent carry a subtree whose children sit elsewhere", () => {
    const all = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];

    expect(sumEstimates([all[0]], all)).toBe(8);
  });

  it("prefers an overridden parent over the children beneath it", () => {
    const items = [
      node("epic", null, 13),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];

    expect(sumEstimates(items)).toBe(13);
  });

  it("skips a child whose grandparent is in the set", () => {
    const items = [
      node("epic", null, null),
      node("story", "epic", null),
      node("task", "story", 4),
    ];

    expect(sumEstimates(items)).toBe(4);
  });
});

describe("attributeEstimates", () => {
  it("splits a rolled-up parent onto the children carrying the work", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];
    const shares = attributeEstimates(items);

    expect(shares.get("epic")).toBe(0);
    expect(shares.get("a")).toBe(3);
    expect(shares.get("b")).toBe(5);
  });

  it("keeps work that is not broken out with the item that brought it in", () => {
    const all = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];
    // Only the epic and one child are in the sprint; `b` sits elsewhere.
    const scope = all.filter((item) => item.id !== "b");
    const shares = attributeEstimates(scope, all);

    expect(shares.get("a")).toBe(3);
    expect(shares.get("epic")).toBe(5);
    expect([...shares.values()].reduce((sum, value) => sum + value, 0)).toBe(
      sumEstimates(scope, all),
    );
  });

  it("does not decompose an overridden parent", () => {
    const items = [
      node("epic", null, 13),
      node("a", "epic", 3),
      node("b", "epic", 5),
    ];
    const shares = attributeEstimates(items);

    expect(shares.get("epic")).toBe(13);
    expect(shares.get("a")).toBe(0);
    expect(shares.get("b")).toBe(0);
  });

  it("attributes through a parent that is outside the set", () => {
    const all = [
      node("epic", null, null),
      node("story", "epic", null),
      node("task", "story", 4),
    ];
    // The epic and the task are scheduled; the story between them is not.
    const scope = all.filter((item) => item.id !== "story");
    const shares = attributeEstimates(scope, all);

    expect(shares.get("task")).toBe(4);
    expect(shares.get("epic")).toBe(0);
  });

  it("does not spin on a parent cycle", () => {
    const items = [node("a", "b", null), node("b", "a", null)];
    expect(attributeEstimates(items).get("a")).toBe(0);
  });
});

describe("bucketEstimates", () => {
  it("adds up to the total when a parent and child are held by different people", () => {
    const items: (EstimateNode & { assignee: string })[] = [
      { ...node("epic", null, 8), assignee: "alice" },
      { ...node("task", "epic", 3), assignee: "bob" },
    ];
    const buckets = bucketEstimates(items, (item) => item.assignee);

    expect(buckets.get("alice")).toBe(8);
    expect(buckets.get("bob")).toBe(0);
    expect([...buckets.values()].reduce((sum, value) => sum + value, 0)).toBe(
      sumEstimates(items),
    );
  });

  it("gives a rolled-up parent's work to whoever holds each child", () => {
    const items: (EstimateNode & { assignee: string })[] = [
      { ...node("epic", null, null), assignee: "alice" },
      { ...node("task", "epic", 3), assignee: "bob" },
    ];
    const buckets = bucketEstimates(items, (item) => item.assignee);

    expect(buckets.get("alice")).toBe(0);
    expect(buckets.get("bob")).toBe(3);
  });

  it("splits a status breakdown without out-totalling the project", () => {
    const items: (EstimateNode & { category: string })[] = [
      { ...node("epic", null, null), category: "in_progress" },
      { ...node("done-task", "epic", 3), category: "done" },
      { ...node("open-task", "epic", 5), category: "todo" },
    ];
    const buckets = bucketEstimates(items, (item) => item.category);

    expect(buckets.get("done")).toBe(3);
    expect(buckets.get("todo")).toBe(5);
    expect(buckets.get("in_progress")).toBe(0);
    expect([...buckets.values()].reduce((sum, value) => sum + value, 0)).toBe(
      sumEstimates(items),
    );
  });
});

describe("countUnestimated", () => {
  it("does not nag about a parent whose children are sized", () => {
    const items = [
      node("epic", null, null),
      node("a", "epic", 3),
      node("b", "epic", null),
    ];

    expect(countUnestimated(items)).toBe(1);
  });
});
