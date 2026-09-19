import { describe, expect, it } from "vitest";

import { parseSort, sortHref, sortRows, type SortState } from "./table-sort";

type Row = Readonly<{ key: string; totals: Record<string, unknown> }>;

function row(key: string, overrides: Record<string, unknown> = {}): Row {
  return {
    key,
    totals: {
      leadsCreated: 1,
      revenueRub: "100.00",
      leadToApplicationPct: 50,
      averageOrderValueRub: "100.00",
      ...overrides,
    },
  };
}

describe("parseSort", () => {
  it("falls back to leads descending for unknown input", () => {
    expect(parseSort(undefined, undefined)).toEqual({
      column: "leadsCreated",
      direction: "desc",
    });
    expect(parseSort("выдуманное", "вверх")).toEqual({
      column: "leadsCreated",
      direction: "desc",
    });
  });

  it("reads a known column and direction", () => {
    expect(parseSort("revenueRub", "asc")).toEqual({
      column: "revenueRub",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  it("orders by a numeric column in both directions", () => {
    const rows = [row("a", { leadsCreated: 1 }), row("b", { leadsCreated: 9 })];

    expect(sortRows(rows, { column: "leadsCreated", direction: "desc" }).map((r) => r.key))
      .toEqual(["b", "a"]);
    expect(sortRows(rows, { column: "leadsCreated", direction: "asc" }).map((r) => r.key))
      .toEqual(["a", "b"]);
  });

  it("compares money by value, not by string", () => {
    const rows = [row("a", { revenueRub: "9.00" }), row("b", { revenueRub: "100.00" })];

    expect(sortRows(rows, { column: "revenueRub", direction: "desc" }).map((r) => r.key))
      .toEqual(["b", "a"]);
  });

  it("keeps a null ratio at the bottom in either direction", () => {
    const rows = [
      row("нет базы", { leadToApplicationPct: null }),
      row("есть", { leadToApplicationPct: 10 }),
    ];
    const sort = (direction: SortState["direction"]) =>
      sortRows(rows, { column: "leadToApplicationPct", direction }).map((r) => r.key);

    expect(sort("desc")).toEqual(["есть", "нет базы"]);
    expect(sort("asc")).toEqual(["есть", "нет базы"]);
  });

  it("does not change the source array", () => {
    const rows = [row("a", { leadsCreated: 1 }), row("b", { leadsCreated: 9 })];
    sortRows(rows, { column: "leadsCreated", direction: "desc" });

    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("sortHref", () => {
  it("keeps the filters and flips the direction of the active column", () => {
    const params = new URLSearchParams("from=2026-09-01&to=2026-09-30&channel=site");
    const current: SortState = { column: "payments", direction: "desc" };

    expect(sortHref("/managers", params, "payments", current)).toContain("dir=asc");
    expect(sortHref("/managers", params, "revenueRub", current)).toContain("dir=desc");
    expect(sortHref("/managers", params, "payments", current)).toContain("channel=site");
  });
});
