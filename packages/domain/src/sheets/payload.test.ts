import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import type { MappingCandidate } from "./mapping.js";
import {
  buildSheetPayload,
  checksumOfUpdates,
  readBackMatches,
  type ChannelsDailyRow,
  type PlanFactRow,
} from "./payload.js";

const SHEET = "каналы сентябрь 2026";
const PLAN_SHEET = "выполнение плана сентябрь 2026";

const mappings: readonly MappingCandidate[] = [
  { reportKind: "channels_daily", logicalField: "report_date", sheetName: SHEET, rangeA1: "A2:A4", valueType: "date" },
  { reportKind: "channels_daily", logicalField: "channel", sheetName: SHEET, rangeA1: "B2:B4", valueType: "text" },
  { reportKind: "channels_daily", logicalField: "leads_created", sheetName: SHEET, rangeA1: "C2:C4", valueType: "integer" },
  { reportKind: "channels_daily", logicalField: "revenue", sheetName: SHEET, rangeA1: "D2:D4", valueType: "money" },
  { reportKind: "plan_fact", logicalField: "completion_pct", sheetName: PLAN_SHEET, rangeA1: "B2:B3", valueType: "percent" },
];

const channelsDaily: readonly ChannelsDailyRow[] = [
  {
    report_date: "2026-09-05",
    channel: "site",
    leads_created: 3,
    applications: 2,
    payments: 1,
    revenue: "120000.50",
  },
  {
    report_date: "2026-09-06",
    channel: "avito",
    leads_created: 1,
    applications: 0,
    payments: 0,
    revenue: "0.00",
  },
];

const planFact: readonly PlanFactRow[] = [
  { metric: "payments", plan_target: "4.00", actual_value: "1", completion_pct: 25 },
];

function payload() {
  return buildSheetPayload({ mappings, channelsDaily, planFact });
}

describe("buildSheetPayload", () => {
  it("writes one column per mapped field inside its own range", () => {
    const result = payload();

    expect(result.updates.map((update) => update.range)).toEqual([
      `${SHEET}!A2:A4`,
      `${SHEET}!B2:B4`,
      `${SHEET}!C2:C4`,
      `${SHEET}!D2:D4`,
      `${PLAN_SHEET}!B2:B3`,
    ]);
    expect(result.updates[2]?.values).toEqual([[3], [1], [""]]);
  });

  it("keeps money exact and never turns it into a number", () => {
    const revenue = payload().updates.find((update) => update.range.endsWith("D2:D4"));

    expect(revenue?.values).toEqual([["120000.50"], ["0.00"], [""]]);
  });

  it("clears the tail of a range so yesterday's rows cannot survive", () => {
    const dates = payload().updates[0];

    expect(dates?.values).toEqual([["2026-09-05"], ["2026-09-06"], [""]]);
  });

  it("counts every cell it is going to write", () => {
    expect(payload().cellCount).toBe(3 + 3 + 3 + 3 + 2);
  });

  it("refuses more rows than the mapped range can hold", () => {
    const tooMany = Array.from({ length: 4 }, (_, index) => ({
      ...(channelsDaily[0] as ChannelsDailyRow),
      report_date: `2026-09-0${index + 1}`,
    }));

    expect(() => buildSheetPayload({ mappings, channelsDaily: tooMany, planFact })).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("refuses a rectangular range, which would be ambiguous", () => {
    const rectangle = [
      { ...(mappings[0] as MappingCandidate), rangeA1: "A2:B4" },
    ];

    expect(() => buildSheetPayload({ mappings: rectangle, channelsDaily, planFact }))
      .toThrow(expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }));
  });

  it("refuses an empty mapping instead of writing nothing quietly", () => {
    expect(() => buildSheetPayload({ mappings: [], channelsDaily, planFact })).toThrow(
      AppError,
    );
  });

  it("refuses a value that does not match its declared type", () => {
    const broken = [
      { ...(mappings[3] as MappingCandidate), logicalField: "channel" },
    ];

    expect(() => buildSheetPayload({ mappings: broken, channelsDaily, planFact })).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  it("is deterministic: the same snapshot gives the same checksum", () => {
    expect(payload().checksum).toBe(payload().checksum);
    expect(payload().checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("changes the checksum when a single kopeck changes", () => {
    const changed = buildSheetPayload({
      mappings,
      channelsDaily: [
        { ...(channelsDaily[0] as ChannelsDailyRow), revenue: "120000.51" },
        channelsDaily[1] as ChannelsDailyRow,
      ],
      planFact,
    });

    expect(changed.checksum).not.toBe(payload().checksum);
  });

  it("does not depend on the order of the updates", () => {
    const result = payload();
    const reversed = [...result.updates].reverse();

    expect(checksumOfUpdates(reversed)).toBe(result.checksum);
  });
});

describe("readBackMatches", () => {
  it("accepts a read-back that equals the intended payload", () => {
    const result = payload();
    const observed = result.updates.map((update) => ({
      range: update.range,
      values: update.values.map((row) => row.map((cell) => String(cell ?? ""))),
    }));

    expect(readBackMatches(result, observed)).toBe(true);
  });

  it("rejects a changed cell, a missing range and a different length", () => {
    const result = payload();
    const observed = result.updates.map((update) => ({
      range: update.range,
      values: update.values.map((row) => row.map((cell) => String(cell ?? ""))),
    }));

    const changed = structuredClone(observed);
    (changed[2] as { values: string[][] }).values[0] = ["99"];
    expect(readBackMatches(result, changed)).toBe(false);
    expect(readBackMatches(result, observed.slice(1))).toBe(false);

    const shortened = structuredClone(observed);
    (shortened[0] as { values: string[][] }).values.pop();
    expect(readBackMatches(result, shortened)).toBe(false);
  });
});
