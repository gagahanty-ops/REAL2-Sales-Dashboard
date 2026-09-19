import { createHash } from "node:crypto";

import type { SheetMetadata } from "./policy.js";

export type LayoutExpectation = Readonly<{
  /** Exact title of the copy, as the administrator confirmed it. */
  expectedTitle: string;
  /** Sheet tabs the reports are written to, by their saved names. */
  requiredSheets: readonly string[];
}>;

export type LayoutValidation = Readonly<{
  valid: boolean;
  missingSheets: readonly string[];
  titleMismatch: boolean;
}>;

/**
 * Fingerprint of a copy's structure. It covers sheet names and grid sizes,
 * sorted by name, so the value does not depend on tab order: publication is
 * blocked when the structure changes, not when somebody drags a tab.
 */
export function computeLayoutFingerprint(metadata: SheetMetadata): string {
  const canonical = JSON.stringify({
    title: metadata.title,
    sheets: [...metadata.sheets]
      .map((sheet) => [sheet.title, sheet.rowCount, sheet.columnCount])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * First validation of a manually created copy: the title must be the one the
 * administrator confirmed, and every sheet the mappings will write to must
 * already exist. Nothing is created or renamed by this system.
 */
export function validateInitialLayout(
  metadata: SheetMetadata,
  expectation: LayoutExpectation,
): LayoutValidation {
  const present = new Set(metadata.sheets.map((sheet) => sheet.title));
  const missingSheets = expectation.requiredSheets
    .filter((name) => !present.has(name))
    .sort();
  const titleMismatch = metadata.title !== expectation.expectedTitle;
  return {
    valid: missingSheets.length === 0 && !titleMismatch,
    missingSheets,
    titleMismatch,
  };
}

/** True when the copy's structure still matches the fingerprint of activation. */
export function layoutMatchesFingerprint(
  metadata: SheetMetadata,
  fingerprint: string,
): boolean {
  return computeLayoutFingerprint(metadata) === fingerprint;
}
