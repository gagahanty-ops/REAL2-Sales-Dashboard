import { AppError } from "@real2/domain";

/**
 * Spreadsheets this system may never write to. The set is a frozen code
 * constant: no environment variable, database row, request or interface can
 * extend or empty it (SECURITY_READ_ONLY §5).
 */
export const PROTECTED_SPREADSHEET_IDS: ReadonlySet<string> = Object.freeze(
  new Set(["123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks"]),
);

const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,200}$/;

export type SheetGrid = Readonly<{
  title: string;
  rowCount: number;
  columnCount: number;
}>;

export type SheetMetadata = Readonly<{
  title: string;
  sheets: readonly SheetGrid[];
}>;

export type SheetValueUpdate = Readonly<{
  range: string;
  values: readonly (readonly (string | number | null)[])[];
}>;

export type SheetClient = Readonly<{
  readMetadata(): Promise<SheetMetadata>;
  readValues(range: string): Promise<readonly (readonly string[])[]>;
  writeValues(
    updates: readonly SheetValueUpdate[],
  ): Promise<Readonly<{ updatedCells: number }>>;
}>;

export type GoogleServiceAccount = Readonly<{
  clientEmail: string;
  privateKey: string;
}>;

export type SheetClientFactory = (
  credentials: GoogleServiceAccount,
  spreadsheetId: string,
  options: Readonly<{ access: "read" | "write" }>,
) => Promise<SheetClient>;

export type SheetContext = Readonly<{
  spreadsheetId: string;
  /** The one copy an administrator activated; anything else is refused. */
  expectedTargetId: string;
  secrets: Readonly<{ readGoogleServiceAccount(): Promise<GoogleServiceAccount> }>;
  factory: SheetClientFactory;
  publishEnabledInEnvironment: boolean;
  controls: Readonly<{ isPublishEnabled(): Promise<boolean> }>;
}>;

/**
 * The single gate every Google call passes. It runs before credentials are
 * read and before any client exists, so a protected or unexpected identifier
 * cannot produce a request even in principle.
 */
export function assertWritableSpreadsheetId(
  spreadsheetId: string,
  expectedTargetId: string,
): string {
  const normalized = spreadsheetId.trim();
  if (!SPREADSHEET_ID.test(normalized)) throw new AppError("E_VALIDATION", 422);
  if (PROTECTED_SPREADSHEET_IDS.has(normalized)) {
    throw new AppError("E_SHEET_PROTECTED", 403);
  }
  const expected = expectedTargetId.trim();
  if (PROTECTED_SPREADSHEET_IDS.has(expected) || normalized !== expected) {
    throw new AppError("E_FORBIDDEN", 403);
  }
  return normalized;
}

/** Read-only client for layout validation; publication switches are irrelevant. */
export async function createSheetReadClient(context: SheetContext): Promise<SheetClient> {
  const spreadsheetId = assertWritableSpreadsheetId(
    context.spreadsheetId,
    context.expectedTargetId,
  );
  const credentials = await context.secrets.readGoogleServiceAccount();
  return context.factory(credentials, spreadsheetId, { access: "read" });
}

/**
 * Write client. Both switches must be on, and the environment switch is checked
 * first, so a disabled deployment never even queries the database control.
 */
export async function createSheetWriteClient(context: SheetContext): Promise<SheetClient> {
  const spreadsheetId = assertWritableSpreadsheetId(
    context.spreadsheetId,
    context.expectedTargetId,
  );
  if (!context.publishEnabledInEnvironment) {
    throw new AppError("E_FORBIDDEN", 403, "Публикация отключена");
  }
  if (!(await context.controls.isPublishEnabled())) {
    throw new AppError("E_FORBIDDEN", 403, "Публикация отключена");
  }
  const credentials = await context.secrets.readGoogleServiceAccount();
  return context.factory(credentials, spreadsheetId, { access: "write" });
}
