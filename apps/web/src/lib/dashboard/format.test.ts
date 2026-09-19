import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatDate,
  formatDelta,
  formatMonth,
  formatPercent,
  formatRubles,
} from "./format";

describe("dashboard formatters", () => {
  // Intl groups with a non-breaking space; the tests spell it out.
  const NBSP = "\u00A0";

  it("groups counts in the Russian way", () => {
    expect(formatCount(7038)).toBe(`7${NBSP}038`);
    expect(formatCount(0)).toBe("0");
  });

  it("keeps kopecks and never invents a currency for a missing value", () => {
    expect(formatRubles("7038599.00")).toContain(`7${NBSP}038${NBSP}599`);
    expect(formatRubles("1000.55")).toContain(`1${NBSP}000,55`);
    expect(formatRubles(null)).toBe("—");
  });

  it("shows a null ratio as an em dash, never as zero", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0 %");
    expect(formatPercent(66.7)).toBe("66,7 %");
  });

  it("signs a positive change and leaves an empty base as an em dash", () => {
    expect(formatDelta(12.5)).toBe("+12,5 %");
    expect(formatDelta(-5)).toBe("-5 %");
    expect(formatDelta(null)).toBe("—");
  });

  it("writes a business date the way a Russian reader expects", () => {
    expect(formatDate("2026-09-05")).toBe("05.09.2026");
    expect(formatDate("не дата")).toBe("не дата");
  });

  it("names a plan month instead of printing its first day", () => {
    expect(formatMonth("2026-09-01")).toBe("сентябрь 2026");
  });

  it("leaves an unparsable month untouched", () => {
    expect(formatMonth("не месяц")).toBe("не месяц");
  });
});
