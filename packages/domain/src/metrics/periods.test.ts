import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { dateRangeLength, previousPeriod } from "./periods.js";

describe("previousPeriod", () => {
  it("compares a day with the previous calendar day", () => {
    expect(previousPeriod({ from: "2026-09-05", to: "2026-09-05" })).toEqual({
      from: "2026-09-04",
      to: "2026-09-04",
    });
  });

  it("compares a week with the previous seven days", () => {
    expect(previousPeriod({ from: "2026-09-07", to: "2026-09-13" })).toEqual({
      from: "2026-08-31",
      to: "2026-09-06",
    });
  });

  it("compares a calendar month with the previous calendar month", () => {
    expect(previousPeriod({ from: "2026-09-01", to: "2026-09-30" })).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("keeps the previous month's own length", () => {
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(previousPeriod({ from: "2028-03-01", to: "2028-03-31" })).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("compares a custom range with the range immediately before it", () => {
    expect(previousPeriod({ from: "2026-09-05", to: "2026-09-08" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-04",
    });
  });

  it("crosses a year boundary", () => {
    expect(previousPeriod({ from: "2027-01-01", to: "2027-01-31" })).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("measures range length in days", () => {
    expect(dateRangeLength({ from: "2026-09-05", to: "2026-09-05" })).toBe(1);
    expect(dateRangeLength({ from: "2026-09-05", to: "2026-09-11" })).toBe(7);
  });

  it("refuses a reversed or malformed range", () => {
    expect(() => previousPeriod({ from: "2026-09-05", to: "2026-09-04" })).toThrow(AppError);
    expect(() => previousPeriod({ from: "2026-09-31", to: "2026-10-01" })).toThrow(AppError);
    expect(() => dateRangeLength({ from: "nope", to: "2026-09-05" })).toThrow(AppError);
  });
});
