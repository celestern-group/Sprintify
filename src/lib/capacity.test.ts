import { describe, expect, it } from "vitest";
import {
  computeMemberCapacity,
  eachWorkingDay,
  holidayDaysIn,
  isValidRange,
  leaveDaysIn,
  plannedPointsFrom,
  rangesOverlap,
  sprintEndFrom,
} from "@/lib/capacity";
import {
  addDaysIso,
  daysBetweenIso,
  isIsoDate,
  isoToLocalDate,
  isoWeekday,
  localDateToIso,
} from "@/lib/date-only";

const WEEKDAYS = [1, 2, 3, 4, 5];

// 2026-03-02 is a Monday; the fortnight to 2026-03-15 is a clean 2-week sprint.
const SPRINT_START = "2026-03-02";
const SPRINT_END = "2026-03-15";

describe("eachWorkingDay", () => {
  it("skips weekends", () => {
    const days = eachWorkingDay(SPRINT_START, SPRINT_END, WEEKDAYS);
    expect(days).toHaveLength(10);
    expect(days[0]).toBe("2026-03-02");
    expect(days.at(-1)).toBe("2026-03-13");
    expect(days).not.toContain("2026-03-07");
    expect(days).not.toContain("2026-03-08");
  });

  it("honours a non-standard working week", () => {
    // Sunday–Thursday, as in much of the Middle East.
    const days = eachWorkingDay(SPRINT_START, SPRINT_END, [0, 1, 2, 3, 4]);
    expect(days).toContain("2026-03-08");
    expect(days).not.toContain("2026-03-13");
  });

  it("returns a single day for a one-day range", () => {
    expect(eachWorkingDay("2026-03-02", "2026-03-02", WEEKDAYS)).toEqual([
      "2026-03-02",
    ]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(eachWorkingDay(SPRINT_END, SPRINT_START, WEEKDAYS)).toEqual([]);
  });

  it("returns nothing when no weekday is a working day", () => {
    expect(eachWorkingDay(SPRINT_START, SPRINT_END, [])).toEqual([]);
  });

  it("crosses a month and a year boundary", () => {
    expect(eachWorkingDay("2026-12-31", "2027-01-01", WEEKDAYS)).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });
});

describe("holidayDaysIn", () => {
  it("counts only holidays that land on a working day", () => {
    const days = eachWorkingDay(SPRINT_START, SPRINT_END, WEEKDAYS);
    // 03-04 is a Wednesday; 03-08 is a Sunday and was never a working day.
    expect(holidayDaysIn(days, ["2026-03-04", "2026-03-08"])).toBe(1);
  });

  it("ignores holidays outside the sprint", () => {
    const days = eachWorkingDay(SPRINT_START, SPRINT_END, WEEKDAYS);
    expect(holidayDaysIn(days, ["2026-02-25", "2026-04-01"])).toBe(0);
  });
});

describe("leaveDaysIn", () => {
  const days = eachWorkingDay(SPRINT_START, SPRINT_END, WEEKDAYS);

  it("counts working days inside the leave range", () => {
    const leave = [
      { startDate: "2026-03-02", endDate: "2026-03-06", portion: 1 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(5);
  });

  it("clamps leave that starts before the sprint", () => {
    const leave = [
      { startDate: "2026-02-20", endDate: "2026-03-03", portion: 1 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(2);
  });

  it("clamps leave that ends after the sprint", () => {
    const leave = [
      { startDate: "2026-03-12", endDate: "2026-04-10", portion: 1 },
    ];
    // 03-12 and 03-13 only; 03-14/15 are the weekend and the sprint ends there.
    expect(leaveDaysIn(days, leave)).toBe(2);
  });

  it("never double-counts a day already lost to a holiday", () => {
    const leave = [
      { startDate: "2026-03-02", endDate: "2026-03-06", portion: 1 },
    ];
    // 03-04 is both a holiday and inside the leave: the week costs 4, not 5.
    expect(leaveDaysIn(days, leave, ["2026-03-04"])).toBe(4);
  });

  it("never double-counts a day covered by two leave records", () => {
    const leave = [
      { startDate: "2026-03-02", endDate: "2026-03-04", portion: 1 },
      { startDate: "2026-03-03", endDate: "2026-03-05", portion: 1 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(4);
  });

  it("takes the larger portion when overlapping records disagree", () => {
    const leave = [
      { startDate: "2026-03-02", endDate: "2026-03-02", portion: 0.5 },
      { startDate: "2026-03-02", endDate: "2026-03-02", portion: 1 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(1);
  });

  it("applies half days", () => {
    const leave = [
      { startDate: "2026-03-02", endDate: "2026-03-06", portion: 0.5 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(2.5);
  });

  it("ignores leave entirely outside the sprint", () => {
    const leave = [
      { startDate: "2026-01-05", endDate: "2026-01-09", portion: 1 },
    ];
    expect(leaveDaysIn(days, leave)).toBe(0);
  });
});

describe("computeMemberCapacity", () => {
  const base = {
    sprintStart: SPRINT_START,
    sprintEnd: SPRINT_END,
    workingWeekdays: WEEKDAYS,
    holidayDates: [] as string[],
    leaves: [],
    hoursPerDay: 8,
    availabilityPercent: 100,
  };

  it("computes a full fortnight", () => {
    const result = computeMemberCapacity(base);
    expect(result.workingDays).toBe(10);
    expect(result.effectiveDays).toBe(10);
    expect(result.plannedHours).toBe(80);
  });

  it("subtracts holidays and leave without double-counting", () => {
    const result = computeMemberCapacity({
      ...base,
      holidayDates: ["2026-03-04"],
      leaves: [{ startDate: "2026-03-02", endDate: "2026-03-06", portion: 1 }],
    });
    expect(result.holidayDays).toBe(1);
    expect(result.leaveDays).toBe(4);
    expect(result.effectiveDays).toBe(5);
    expect(result.plannedHours).toBe(40);
  });

  it("scales what is left, not the raw sprint", () => {
    // A week off then 50% available: half of the REMAINING week, not
    // half the sprint minus a full week.
    const result = computeMemberCapacity({
      ...base,
      availabilityPercent: 50,
      leaves: [{ startDate: "2026-03-02", endDate: "2026-03-06", portion: 1 }],
    });
    expect(result.effectiveDays).toBe(2.5);
    expect(result.plannedHours).toBe(20);
  });

  it("floors at zero when leave exceeds the sprint", () => {
    const result = computeMemberCapacity({
      ...base,
      leaves: [{ startDate: "2026-01-01", endDate: "2026-12-31", portion: 1 }],
    });
    expect(result.effectiveDays).toBe(0);
    expect(result.plannedHours).toBe(0);
  });

  it("returns zero for 0% availability", () => {
    const result = computeMemberCapacity({ ...base, availabilityPercent: 0 });
    expect(result.workingDays).toBe(10);
    expect(result.plannedHours).toBe(0);
  });

  it("clamps an out-of-range availability", () => {
    expect(
      computeMemberCapacity({ ...base, availabilityPercent: 500 }).plannedHours,
    ).toBe(80);
    expect(
      computeMemberCapacity({ ...base, availabilityPercent: -20 }).plannedHours,
    ).toBe(0);
  });

  it("handles a sprint with no working days at all", () => {
    const result = computeMemberCapacity({
      ...base,
      sprintStart: "2026-03-07",
      sprintEnd: "2026-03-08",
    });
    expect(result.workingDays).toBe(0);
    expect(result.plannedHours).toBe(0);
  });

  it("rounds to the two decimals the numeric columns hold", () => {
    const result = computeMemberCapacity({
      ...base,
      availabilityPercent: 33,
      hoursPerDay: 7.5,
    });
    expect(result.effectiveDays).toBe(3.3);
    expect(result.plannedHours).toBe(24.75);
  });
});

describe("plannedPointsFrom", () => {
  it("prorates the baseline by presence", () => {
    expect(plannedPointsFrom(20, { workingDays: 10, effectiveDays: 5 })).toBe(
      10,
    );
  });

  it("returns zero without a baseline", () => {
    expect(plannedPointsFrom(0, { workingDays: 10, effectiveDays: 5 })).toBe(0);
  });

  it("returns zero when the sprint has no working days", () => {
    expect(plannedPointsFrom(20, { workingDays: 0, effectiveDays: 0 })).toBe(0);
  });
});

describe("sprintEndFrom", () => {
  it("is inclusive of both ends", () => {
    expect(sprintEndFrom("2026-03-02", 14)).toBe("2026-03-15");
    expect(sprintEndFrom("2026-03-02", 1)).toBe("2026-03-02");
  });

  it("treats a zero or negative length as one day", () => {
    expect(sprintEndFrom("2026-03-02", 0)).toBe("2026-03-02");
  });
});

describe("rangesOverlap", () => {
  it("detects a shared day", () => {
    expect(
      rangesOverlap("2026-03-02", "2026-03-15", "2026-03-15", "2026-03-20"),
    ).toBe(true);
  });

  it("rejects adjacent ranges", () => {
    expect(
      rangesOverlap("2026-03-02", "2026-03-15", "2026-03-16", "2026-03-20"),
    ).toBe(false);
  });
});

describe("isValidRange", () => {
  it("accepts an ordered pair", () => {
    expect(isValidRange("2026-03-02", "2026-03-02")).toBe(true);
  });

  it("rejects an inverted pair and malformed input", () => {
    expect(isValidRange("2026-03-15", "2026-03-02")).toBe(false);
    expect(isValidRange("2026-3-2", "2026-03-15")).toBe(false);
    expect(isValidRange("not-a-date", "2026-03-15")).toBe(false);
  });
});

describe("date-only helpers", () => {
  it("validates real calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("20260201")).toBe(false);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("counts days inclusively", () => {
    expect(daysBetweenIso("2026-03-02", "2026-03-02")).toBe(1);
    expect(daysBetweenIso("2026-03-02", "2026-03-15")).toBe(14);
  });

  it("reports weekdays with Sunday as 0", () => {
    expect(isoWeekday("2026-03-01")).toBe(0);
    expect(isoWeekday("2026-03-02")).toBe(1);
  });

  // The reason the whole module exists: a Date round-trip must not move the
  // day, whatever the runner's timezone or DST state.
  it("round-trips through a local Date without shifting the day", () => {
    for (const value of [
      "2026-01-01",
      "2026-03-08", // US DST spring-forward
      "2026-03-29", // EU DST spring-forward
      "2026-10-25", // EU DST fall-back
      "2026-11-01", // US DST fall-back
      "2026-12-31",
    ]) {
      expect(localDateToIso(isoToLocalDate(value))).toBe(value);
    }
  });
});
