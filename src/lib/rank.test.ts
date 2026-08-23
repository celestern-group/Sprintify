import { describe, expect, it } from "vitest";
import {
  between,
  INITIAL_RANK,
  rankAfter,
  rankBefore,
  rankSequence,
} from "./rank";

describe("rank", () => {
  it("places a value strictly between its bounds", () => {
    const mid = between("a", "b");
    expect(mid > "a").toBe(true);
    expect(mid < "b").toBe(true);
  });

  it("handles an open lower bound", () => {
    const first = rankBefore(INITIAL_RANK);
    expect(first < INITIAL_RANK).toBe(true);
  });

  it("handles an open upper bound", () => {
    const last = rankAfter(INITIAL_RANK);
    expect(last > INITIAL_RANK).toBe(true);
  });

  it("terminates when the upper bound has a low-digit prefix", () => {
    // The case that loops forever without tie tracking: "01" is a valid rank
    // whose first character is already the alphabet minimum.
    const mid = between(null, "01");
    expect(mid < "01").toBe(true);
    expect(mid.length).toBeLessThan(10);
  });

  it("survives repeated insertion at the same point", () => {
    let low = "a";
    const high = "b";
    for (let index = 0; index < 200; index += 1) {
      const next = between(low, high);
      expect(next > low).toBe(true);
      expect(next < high).toBe(true);
      low = next;
    }
  });

  it("never emits a rank that blocks a later insert before it", () => {
    // A trailing minimum character would leave no expressible midpoint.
    for (let index = 0; index < 50; index += 1) {
      const value = rankSequence(null, 50)[index];
      expect(value.endsWith("0")).toBe(false);
    }
  });

  it("returns an ascending sequence", () => {
    const ranks = rankSequence(null, 10);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("rejects bounds that are out of order", () => {
    expect(() => between("b", "a")).toThrow();
    expect(() => between("a", "a")).toThrow();
  });
});
