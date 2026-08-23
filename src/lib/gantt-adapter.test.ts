import { describe, expect, it } from "vitest";
import { localDateToIso } from "@/lib/date-only";
import {
  featureToDates,
  holidaysToMarkers,
  sprintToFeature,
} from "@/lib/gantt-adapter";

const SPRINT = {
  id: "s1",
  name: "Sprint 4",
  startDate: "2026-03-02",
  endDate: "2026-03-15",
  state: "planning" as const,
};

describe("sprintToFeature", () => {
  it("keeps the dates the user typed, whatever the runner's timezone", () => {
    const feature = sprintToFeature(SPRINT);
    expect(localDateToIso(feature.startAt)).toBe("2026-03-02");
    expect(localDateToIso(feature.endAt)).toBe("2026-03-15");
  });

  it("maps state to a distinct status", () => {
    expect(sprintToFeature(SPRINT).status.id).toBe("planning");
    expect(sprintToFeature({ ...SPRINT, state: "active" }).status.id).toBe(
      "active",
    );
    expect(sprintToFeature({ ...SPRINT, state: "completed" }).status.id).toBe(
      "completed",
    );
  });

  // The whole reason gantt-adapter exists.
  it("survives a round trip across DST boundaries", () => {
    for (const [start, end] of [
      ["2026-03-08", "2026-03-21"],
      ["2026-03-29", "2026-04-11"],
      ["2026-10-25", "2026-11-07"],
      ["2026-12-28", "2027-01-10"],
    ]) {
      const feature = sprintToFeature({
        ...SPRINT,
        startDate: start,
        endDate: end,
      });
      const back = featureToDates(feature.startAt, feature.endAt, {
        startDate: start,
        endDate: end,
      });
      expect(back).toEqual({ startDate: start, endDate: end });
    }
  });
});

describe("featureToDates", () => {
  it("preserves the sprint length when only the start moves", () => {
    const moved = featureToDates(new Date(2026, 2, 9, 12), null, {
      startDate: "2026-03-02",
      endDate: "2026-03-15",
    });
    expect(moved).toEqual({ startDate: "2026-03-09", endDate: "2026-03-22" });
  });

  it("preserves length across a month boundary", () => {
    const moved = featureToDates(new Date(2026, 11, 28, 12), null, {
      startDate: "2026-03-02",
      endDate: "2026-03-15",
    });
    expect(moved).toEqual({ startDate: "2026-12-28", endDate: "2027-01-10" });
  });

  it("takes both dates from a resize", () => {
    const resized = featureToDates(
      new Date(2026, 2, 2, 12),
      new Date(2026, 2, 20, 12),
      { startDate: "2026-03-02", endDate: "2026-03-15" },
    );
    expect(resized).toEqual({ startDate: "2026-03-02", endDate: "2026-03-20" });
  });

  it("collapses an inverted drop rather than storing a negative range", () => {
    const inverted = featureToDates(
      new Date(2026, 2, 20, 12),
      new Date(2026, 2, 2, 12),
      { startDate: "2026-03-02", endDate: "2026-03-15" },
    );
    expect(inverted).toEqual({
      startDate: "2026-03-20",
      endDate: "2026-03-20",
    });
  });

  it("handles a single-day sprint", () => {
    const moved = featureToDates(new Date(2026, 2, 9, 12), null, {
      startDate: "2026-03-02",
      endDate: "2026-03-02",
    });
    expect(moved).toEqual({ startDate: "2026-03-09", endDate: "2026-03-09" });
  });
});

describe("holidaysToMarkers", () => {
  it("keeps the date and labels the marker", () => {
    const [marker] = holidaysToMarkers([{ date: "2026-03-04", name: "Holi" }]);
    expect(localDateToIso(marker.date)).toBe("2026-03-04");
    expect(marker.label).toBe("Holi");
    expect(marker.id).toBe("holiday-2026-03-04");
  });
});
