import { AppError } from "../errors.js";

export type SheetReportKind = "channels_daily" | "plan_fact";
export type SheetValueType = "integer" | "money" | "percent" | "date" | "text";

export type MappingCandidate = Readonly<{
  reportKind: SheetReportKind;
  logicalField: string;
  sheetName: string;
  rangeA1: string;
  valueType: SheetValueType;
  required?: boolean;
}>;

export type SheetGridLayout = Readonly<{
  title: string;
  rowCount: number;
  columnCount: number;
}>;

/** Fields each report must map before a target may be activated. */
export const REQUIRED_MAPPING_FIELDS: Readonly<
  Record<SheetReportKind, readonly string[]>
> = {
  channels_daily: [
    "report_date",
    "channel",
    "leads_created",
    "applications",
    "payments",
    "revenue",
  ],
  plan_fact: ["metric", "plan_target", "actual_value", "completion_pct"],
};

export type A1Range = Readonly<{
  startColumn: number;
  startRow: number;
  endColumn: number;
  endRow: number;
  cellCount: number;
}>;

const A1_CELL = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index;
}

/** Parses `B2:D31`, or a single cell, into inclusive one-based bounds. */
export function parseA1Range(range: string): A1Range {
  const [start, end] = range.split(":");
  const startMatch = A1_CELL.exec(start ?? "");
  const endMatch = end === undefined ? startMatch : A1_CELL.exec(end);
  if (!startMatch || !endMatch) throw new AppError("E_VALIDATION", 422);

  const startColumn = columnIndex(startMatch[1] as string);
  const startRow = Number(startMatch[2]);
  const endColumn = columnIndex(endMatch[1] as string);
  const endRow = Number(endMatch[2]);
  if (endColumn < startColumn || endRow < startRow) throw new AppError("E_VALIDATION", 422);

  return {
    startColumn,
    startRow,
    endColumn,
    endRow,
    cellCount: (endColumn - startColumn + 1) * (endRow - startRow + 1),
  };
}

export function rangesOverlap(left: A1Range, right: A1Range): boolean {
  return (
    left.startColumn <= right.endColumn
    && right.startColumn <= left.endColumn
    && left.startRow <= right.endRow
    && right.startRow <= left.endRow
  );
}

/**
 * Validates a complete mapping candidate against the copy's real layout.
 * Publication writes only these ranges, so anything ambiguous — an unknown
 * sheet, a range outside the grid, two fields sharing cells, a missing
 * required field — is refused before a target can be activated.
 */
export function validateMapping(
  candidates: readonly MappingCandidate[],
  layout: readonly SheetGridLayout[],
): void {
  if (candidates.length === 0) throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
  const sheets = new Map(layout.map((sheet) => [sheet.title, sheet]));
  const parsed = candidates.map((candidate) => {
    const sheet = sheets.get(candidate.sheetName);
    if (!sheet) throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
    const range = parseA1Range(candidate.rangeA1);
    if (range.endRow > sheet.rowCount || range.endColumn > sheet.columnCount) {
      throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
    }
    return { candidate, range };
  });

  for (let index = 0; index < parsed.length; index += 1) {
    for (let other = index + 1; other < parsed.length; other += 1) {
      const left = parsed[index];
      const right = parsed[other];
      if (!left || !right) continue;
      if (left.candidate.sheetName !== right.candidate.sheetName) continue;
      if (rangesOverlap(left.range, right.range)) {
        throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
      }
      if (
        left.candidate.reportKind === right.candidate.reportKind
        && left.candidate.logicalField === right.candidate.logicalField
      ) {
        throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
      }
    }
  }

  for (const [reportKind, fields] of Object.entries(REQUIRED_MAPPING_FIELDS)) {
    const mapped = new Set(
      candidates
        .filter((candidate) => candidate.reportKind === reportKind)
        .map((candidate) => candidate.logicalField),
    );
    if (mapped.size === 0) continue;
    for (const field of fields) {
      if (!mapped.has(field)) throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
    }
  }
}

/** Reports whether every report kind is mapped, which activation requires. */
export function mappingIsComplete(candidates: readonly MappingCandidate[]): boolean {
  return Object.entries(REQUIRED_MAPPING_FIELDS).every(([reportKind, fields]) => {
    const mapped = new Set(
      candidates
        .filter((candidate) => candidate.reportKind === reportKind)
        .map((candidate) => candidate.logicalField),
    );
    return fields.every((field) => mapped.has(field));
  });
}
