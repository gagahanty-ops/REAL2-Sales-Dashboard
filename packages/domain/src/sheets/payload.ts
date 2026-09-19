import { createHash } from "node:crypto";

import { AppError } from "../errors.js";
import { parseA1Range, type MappingCandidate } from "./mapping.js";

export type SheetCellValue = string | number | null;

export type ChannelsDailyRow = Readonly<{
  report_date: string;
  channel: string;
  leads_created: number;
  applications: number;
  payments: number;
  revenue: string;
}>;

export type PlanFactRow = Readonly<{
  metric: string;
  plan_target: string | null;
  actual_value: string;
  completion_pct: number | null;
}>;

export type SheetPayloadInput = Readonly<{
  mappings: readonly MappingCandidate[];
  channelsDaily: readonly ChannelsDailyRow[];
  planFact: readonly PlanFactRow[];
}>;

export type SheetUpdate = Readonly<{
  range: string;
  values: readonly (readonly SheetCellValue[])[];
}>;

export type SheetPayload = Readonly<{
  updates: readonly SheetUpdate[];
  cellCount: number;
  /** Checksum of exactly what will be written, in a stable order. */
  checksum: string;
}>;

function formatValue(value: unknown, valueType: MappingCandidate["valueType"]): SheetCellValue {
  if (value === null || value === undefined) return "";
  if (valueType === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new AppError("E_VALIDATION", 422);
    }
    return value;
  }
  if (valueType === "money") {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(value)) {
      throw new AppError("E_VALIDATION", 422);
    }
    // Money stays an exact decimal string: a float would round kopecks.
    return value;
  }
  if (valueType === "percent") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new AppError("E_VALIDATION", 422);
    }
    return value;
  }
  if (valueType === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppError("E_VALIDATION", 422);
    }
    return value;
  }
  return String(value);
}

function columnValues(
  rows: readonly Record<string, unknown>[],
  mapping: MappingCandidate,
  rowCapacity: number,
): readonly (readonly SheetCellValue[])[] {
  if (rows.length > rowCapacity) throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
  const values: SheetCellValue[][] = rows.map((row) => [
    formatValue(row[mapping.logicalField], mapping.valueType),
  ]);
  // Rows that disappeared must be cleared, not left as stale numbers.
  while (values.length < rowCapacity) values.push([""]);
  return values;
}

function canonicalize(updates: readonly SheetUpdate[]): string {
  return JSON.stringify(
    [...updates]
      .map((update) => [update.range, update.values.map((row) => [...row])])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

export function checksumOfUpdates(updates: readonly SheetUpdate[]): string {
  return createHash("sha256").update(canonicalize(updates)).digest("hex");
}

/**
 * Turns one snapshot's report rows into the exact cells of the mapped ranges.
 * Every mapping is a single column: the payload never invents a range, never
 * writes outside one, and clears the tail so a shorter report cannot leave
 * yesterday's numbers behind.
 */
export function buildSheetPayload(input: SheetPayloadInput): SheetPayload {
  if (input.mappings.length === 0) throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);

  const updates: SheetUpdate[] = [];
  for (const mapping of input.mappings) {
    const range = parseA1Range(mapping.rangeA1);
    if (range.endColumn !== range.startColumn) {
      // One logical field is one column; a rectangle would make the mapping
      // ambiguous about which value lands where.
      throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
    }
    const rowCapacity = range.endRow - range.startRow + 1;
    const rows = mapping.reportKind === "channels_daily"
      ? (input.channelsDaily as readonly Record<string, unknown>[])
      : (input.planFact as readonly Record<string, unknown>[]);
    updates.push({
      range: `${mapping.sheetName}!${mapping.rangeA1}`,
      values: columnValues(rows, mapping, rowCapacity),
    });
  }

  const cellCount = updates.reduce((sum, update) => sum + update.values.length, 0);
  return { updates, cellCount, checksum: checksumOfUpdates(updates) };
}

/** Compares what Google reports back with what we intended to write. */
export function readBackMatches(
  payload: SheetPayload,
  observed: readonly Readonly<{ range: string; values: readonly (readonly string[])[] }>[],
): boolean {
  const expected = new Map(
    payload.updates.map((update) => [
      update.range,
      update.values.map((row) => row.map((cell) => (cell === null ? "" : String(cell)))),
    ]),
  );
  if (observed.length !== expected.size) return false;
  for (const item of observed) {
    const want = expected.get(item.range);
    if (!want) return false;
    if (want.length !== item.values.length) return false;
    for (let index = 0; index < want.length; index += 1) {
      const wantRow = want[index] ?? [];
      const gotRow = item.values[index] ?? [];
      if (wantRow.length !== gotRow.length) return false;
      for (let cell = 0; cell < wantRow.length; cell += 1) {
        if (wantRow[cell] !== gotRow[cell]) return false;
      }
    }
  }
  return true;
}
