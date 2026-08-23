import { describe, expect, it } from "vitest";
import { medianPoints } from "./estimate";

describe("medianPoints", () => {
  it("is null when there is nothing to read from", () => {
    expect(medianPoints([])).toBeNull();
  });

  it("takes the middle value of an odd set", () => {
    expect(medianPoints([1, 3, 8])).toBe(3);
  });

  it("averages the two middle values of an even set", () => {
    expect(medianPoints([1, 2, 3, 8])).toBe(2.5);
  });

  it("does not care about input order", () => {
    expect(medianPoints([8, 1, 3])).toBe(3);
  });

  it("ignores an outlier the mean would follow", () => {
    // Mean is 7.4; the median is what a team would actually plan around.
    expect(medianPoints([3, 3, 3, 3, 21])).toBe(3);
  });

  it("rounds to the nearest half", () => {
    expect(medianPoints([2, 3])).toBe(2.5);
    expect(medianPoints([1, 2, 2, 5])).toBe(2);
    expect(medianPoints([1.3, 1.4])).toBe(1.5);
  });

  it("handles a single comparable item", () => {
    expect(medianPoints([5])).toBe(5);
  });
});
