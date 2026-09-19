import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import {
  REQUIRED_MAPPING_FIELDS,
  mappingIsComplete,
  parseA1Range,
  rangesOverlap,
  validateMapping,
  type MappingCandidate,
  type SheetGridLayout,
} from "./mapping.js";

const CHANNELS_SHEET = "каналы сентябрь 2026";
const PLAN_SHEET = "выполнение плана сентябрь 2026";

const layout: readonly SheetGridLayout[] = [
  { title: CHANNELS_SHEET, rowCount: 100, columnCount: 12 },
  { title: PLAN_SHEET, rowCount: 50, columnCount: 8 },
];

function channelsMapping(): MappingCandidate[] {
  const columns = ["A", "B", "C", "D", "E", "F"];
  return REQUIRED_MAPPING_FIELDS.channels_daily.map((logicalField, index) => ({
    reportKind: "channels_daily" as const,
    logicalField,
    sheetName: CHANNELS_SHEET,
    rangeA1: `${columns[index]}2:${columns[index]}31`,
    valueType: logicalField === "revenue" ? ("money" as const) : ("text" as const),
  }));
}

function planMapping(): MappingCandidate[] {
  const columns = ["A", "B", "C", "D"];
  return REQUIRED_MAPPING_FIELDS.plan_fact.map((logicalField, index) => ({
    reportKind: "plan_fact" as const,
    logicalField,
    sheetName: PLAN_SHEET,
    rangeA1: `${columns[index]}2:${columns[index]}10`,
    valueType: "text" as const,
  }));
}

describe("parseA1Range", () => {
  it("reads a rectangle and counts its cells", () => {
    expect(parseA1Range("B2:D31")).toEqual({
      startColumn: 2,
      startRow: 2,
      endColumn: 4,
      endRow: 31,
      cellCount: 90,
    });
  });

  it("reads a single cell as a one-cell rectangle", () => {
    expect(parseA1Range("D5")).toMatchObject({ cellCount: 1, startColumn: 4, endRow: 5 });
  });

  it("handles columns beyond Z", () => {
    expect(parseA1Range("AA1")).toMatchObject({ startColumn: 27 });
    expect(parseA1Range("AB1:AC2")).toMatchObject({ startColumn: 28, endColumn: 29 });
  });

  it("refuses a reversed or malformed range", () => {
    for (const range of ["D5:B2", "B0", "2B", "", "B2:", "лист!B2"]) {
      expect(() => parseA1Range(range)).toThrow(AppError);
    }
  });
});

describe("rangesOverlap", () => {
  it("detects touching rectangles and separates neighbours", () => {
    expect(rangesOverlap(parseA1Range("A2:B31"), parseA1Range("B2:C31"))).toBe(true);
    expect(rangesOverlap(parseA1Range("A2:A31"), parseA1Range("B2:B31"))).toBe(false);
    expect(rangesOverlap(parseA1Range("A2:C10"), parseA1Range("A11:C20"))).toBe(false);
  });
});

describe("validateMapping", () => {
  it("accepts a complete mapping of both reports", () => {
    expect(() => validateMapping([...channelsMapping(), ...planMapping()], layout))
      .not.toThrow();
  });

  it("rejects overlapping output ranges", () => {
    const candidate = [
      {
        reportKind: "channels_daily" as const,
        logicalField: "leads_created",
        sheetName: CHANNELS_SHEET,
        rangeA1: "A2:B31",
        valueType: "integer" as const,
      },
      {
        reportKind: "channels_daily" as const,
        logicalField: "applications",
        sheetName: CHANNELS_SHEET,
        rangeA1: "B2:C31",
        valueType: "integer" as const,
      },
    ];

    expect(() => validateMapping(candidate, layout)).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("rejects a sheet the copy does not have", () => {
    const candidate = channelsMapping().map((mapping) => ({
      ...mapping,
      sheetName: "несуществующий лист",
    }));

    expect(() => validateMapping(candidate, layout)).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("rejects a range outside the real grid", () => {
    const candidate = channelsMapping();
    candidate[0] = { ...(candidate[0] as MappingCandidate), rangeA1: "A2:A200" };

    expect(() => validateMapping(candidate, layout)).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("rejects a report whose required field is missing", () => {
    const candidate = channelsMapping().slice(0, 3);

    expect(() => validateMapping(candidate, layout)).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("rejects an empty mapping instead of silently writing nothing", () => {
    expect(() => validateMapping([], layout)).toThrow(AppError);
  });

  it("rejects two mappings of one field in the same report", () => {
    const candidate = [...channelsMapping()];
    candidate.push({
      reportKind: "channels_daily",
      logicalField: "revenue",
      sheetName: CHANNELS_SHEET,
      rangeA1: "H2:H31",
      valueType: "money",
    });

    expect(() => validateMapping(candidate, layout)).toThrow(
      expect.objectContaining({ code: "E_SHEET_LAYOUT_MISMATCH" }),
    );
  });

  it("allows the same range on different sheets", () => {
    const candidate = [
      ...channelsMapping(),
      ...planMapping().map((mapping, index) => ({
        ...mapping,
        rangeA1: index === 0 ? "A2:A31" : mapping.rangeA1,
      })),
    ];

    expect(() => validateMapping(candidate, layout)).not.toThrow();
  });
});

describe("mappingIsComplete", () => {
  it("requires both reports before activation", () => {
    expect(mappingIsComplete(channelsMapping())).toBe(false);
    expect(mappingIsComplete([...channelsMapping(), ...planMapping()])).toBe(true);
  });
});
