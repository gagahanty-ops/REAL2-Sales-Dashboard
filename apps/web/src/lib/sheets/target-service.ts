import {
  disableSheetTarget,
  getSheetTarget,
  listSheetLayoutMappings,
  markSheetTargetValidated,
  replaceSheetLayoutMappings,
  type Database,
  type SheetTarget,
} from "@real2/db";
import { AppError, mappingIsComplete, validateMapping } from "@real2/domain";
import {
  computeLayoutFingerprint,
  createSheetReadClient,
  type SheetClientFactory,
  type SheetMetadata,
} from "@real2/integrations";

export type SheetSecrets = Readonly<{
  readGoogleServiceAccount(): Promise<
    Readonly<{ clientEmail: string; privateKey: string }>
  >;
}>;

export type TargetServiceDeps = Readonly<{
  db: Database;
  factory: SheetClientFactory;
  secrets: SheetSecrets;
}>;

export type ValidationReport = Readonly<{
  target: SheetTarget;
  layoutFingerprint: string;
  sheets: readonly string[];
  mappedFields: number;
}>;

/**
 * Reads the copy's structure and confirms that every configured mapping fits
 * it. Nothing is written to Google here: validation is a read-only operation,
 * and the publication switches are irrelevant to it.
 */
export async function validateSheetTarget(
  deps: TargetServiceDeps,
  targetId: string,
): Promise<ValidationReport> {
  const target = await getSheetTarget(deps.db, targetId);
  if (!target) throw new AppError("E_NOT_FOUND", 404);
  if (target.status === "disabled") throw new AppError("E_CONFLICT", 409);

  const mappings = await listSheetLayoutMappings(deps.db, targetId);
  if (mappings.length === 0) throw new AppError("E_CONFIG_INCOMPLETE", 409);

  const client = await createSheetReadClient({
    spreadsheetId: target.spreadsheetId,
    expectedTargetId: target.spreadsheetId,
    secrets: deps.secrets,
    factory: deps.factory,
    publishEnabledInEnvironment: false,
    controls: { isPublishEnabled: async () => false },
  });
  const metadata: SheetMetadata = await client.readMetadata();

  if (metadata.title !== target.expectedTitle) {
    throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
  }
  validateMapping(
    mappings.map((mapping) => ({
      reportKind: mapping.reportKind,
      logicalField: mapping.logicalField,
      sheetName: mapping.sheetName,
      rangeA1: mapping.rangeA1,
      valueType: mapping.valueType,
      required: mapping.required,
    })),
    metadata.sheets.map((sheet) => ({
      title: sheet.title,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
    })),
  );

  const layoutFingerprint = computeLayoutFingerprint(metadata);
  const validated = await markSheetTargetValidated(
    deps.db,
    targetId,
    layoutFingerprint,
  );

  return {
    target: validated,
    layoutFingerprint,
    sheets: metadata.sheets.map((sheet) => sheet.title),
    mappedFields: mappings.length,
  };
}

/**
 * Replaces the whole mapping of a target that is not active. An active target
 * must be taken back to validation first, so a live report cannot change shape
 * underneath a publication.
 */
export async function replaceMappings(
  deps: TargetServiceDeps,
  targetId: string,
  candidates: readonly Parameters<typeof replaceSheetLayoutMappings>[2][number][],
): Promise<Readonly<{ count: number; complete: boolean }>> {
  const target = await getSheetTarget(deps.db, targetId);
  if (!target) throw new AppError("E_NOT_FOUND", 404);
  if (target.status === "active" || target.status === "disabled") {
    throw new AppError("E_CONFLICT", 409);
  }
  const saved = await replaceSheetLayoutMappings(deps.db, targetId, candidates);
  return {
    count: saved.length,
    complete: mappingIsComplete(
      saved.map((mapping) => ({
        reportKind: mapping.reportKind,
        logicalField: mapping.logicalField,
        sheetName: mapping.sheetName,
        rangeA1: mapping.rangeA1,
        valueType: mapping.valueType,
      })),
    ),
  };
}

/** Blocks a target whose structure drifted away from the activated one. */
export async function blockDriftedTarget(
  deps: TargetServiceDeps,
  targetId: string,
): Promise<SheetTarget> {
  return disableSheetTarget(deps.db, targetId);
}
