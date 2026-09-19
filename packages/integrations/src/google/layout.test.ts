import { describe, expect, it } from "vitest";

import {
  computeLayoutFingerprint,
  layoutMatchesFingerprint,
  validateInitialLayout,
} from "./layout.js";
import type { SheetMetadata } from "./policy.js";

function layoutFixture(
  overrides: Partial<{ title: string; sheetNames: readonly string[] }> = {},
): SheetMetadata {
  const names = overrides.sheetNames ?? [
    "каналы сентябрь 2026",
    "выполнение плана сентябрь 2026",
  ];
  return {
    title: overrides.title ?? "Копия отчёта РЕАЛ ДВА",
    sheets: names.map((title, index) => ({
      title,
      rowCount: 100 + index,
      columnCount: 12,
    })),
  };
}

const EXPECTATION = {
  expectedTitle: "Копия отчёта РЕАЛ ДВА",
  requiredSheets: ["каналы сентябрь 2026", "выполнение плана сентябрь 2026"],
} as const;

describe("validateInitialLayout", () => {
  it("accepts a copy that has both configured sheets", () => {
    expect(validateInitialLayout(layoutFixture(), EXPECTATION)).toEqual({
      valid: true,
      missingSheets: [],
      titleMismatch: false,
    });
  });

  it("names the sheet the copy is missing", () => {
    const result = validateInitialLayout(
      layoutFixture({ sheetNames: ["каналы сентябрь 2026"] }),
      EXPECTATION,
    );

    expect(result).toEqual({
      valid: false,
      missingSheets: ["выполнение плана сентябрь 2026"],
      titleMismatch: false,
    });
  });

  it("refuses a copy whose title is not the confirmed one", () => {
    const result = validateInitialLayout(
      layoutFixture({ title: "Оригинал отчёта" }),
      EXPECTATION,
    );

    expect(result.valid).toBe(false);
    expect(result.titleMismatch).toBe(true);
  });
});

describe("computeLayoutFingerprint", () => {
  it("is stable for the same structure regardless of tab order", () => {
    const first = computeLayoutFingerprint(layoutFixture());
    const reordered = computeLayoutFingerprint({
      ...layoutFixture(),
      sheets: [...layoutFixture().sheets].reverse(),
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
  });

  it("changes when a sheet is renamed, added or resized", () => {
    const base = computeLayoutFingerprint(layoutFixture());

    expect(computeLayoutFingerprint(layoutFixture({ sheetNames: ["каналы сентябрь 2026"] })))
      .not.toBe(base);
    expect(
      computeLayoutFingerprint({
        ...layoutFixture(),
        sheets: layoutFixture().sheets.map((sheet) => ({ ...sheet, columnCount: 13 })),
      }),
    ).not.toBe(base);
    expect(computeLayoutFingerprint(layoutFixture({ title: "Другая копия" }))).not.toBe(base);
  });

  it("recognises an unchanged copy and rejects a drifted one", () => {
    const fingerprint = computeLayoutFingerprint(layoutFixture());

    expect(layoutMatchesFingerprint(layoutFixture(), fingerprint)).toBe(true);
    expect(
      layoutMatchesFingerprint(
        layoutFixture({ sheetNames: ["каналы сентябрь 2026", "новый лист"] }),
        fingerprint,
      ),
    ).toBe(false);
  });
});
