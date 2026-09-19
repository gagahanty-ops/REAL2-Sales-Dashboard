import { AppError } from "@real2/domain";

import type { Database } from "./client.js";

/**
 * The original spreadsheet the business already uses. It is a code constant on
 * purpose: no environment variable, request, database row or interface can
 * turn it into a publication target (SECURITY_READ_ONLY §5).
 */
export const PROTECTED_SPREADSHEET_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";

export type SheetTargetStatus = "draft" | "validated" | "active" | "disabled";
export type SheetReportKind = "channels_daily" | "plan_fact";
export type SheetValueType = "integer" | "money" | "percent" | "date" | "text";
export type PublicationStatus = "running" | "success" | "failed" | "blocked";

export type SheetTarget = Readonly<{
  id: string;
  spreadsheetId: string;
  expectedTitle: string;
  status: SheetTargetStatus;
  layoutFingerprint: string | null;
  validatedAt: Date | null;
  activatedBy: string | null;
  activatedAt: Date | null;
}>;

export type SheetLayoutMapping = Readonly<{
  id: string;
  targetId: string;
  reportKind: SheetReportKind;
  logicalField: string;
  sheetName: string;
  rangeA1: string;
  valueType: SheetValueType;
  required: boolean;
}>;

export type SheetPublication = Readonly<{
  id: string;
  traceId: string;
  targetId: string;
  snapshotId: string;
  attempt: number;
  status: PublicationStatus;
  layoutFingerprint: string;
  payloadChecksum: string;
  cellsPlanned: number;
  cellsWritten: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
}>;

type TargetRow = {
  id: string;
  spreadsheet_id: string;
  expected_title: string;
  status: SheetTargetStatus;
  layout_fingerprint: string | null;
  validated_at: Date | null;
  activated_by: string | null;
  activated_at: Date | null;
};

type MappingRow = {
  id: string;
  target_id: string;
  report_kind: SheetReportKind;
  logical_field: string;
  sheet_name: string;
  range_a1: string;
  value_type: SheetValueType;
  required: boolean;
};

type PublicationRow = {
  id: string;
  trace_id: string;
  target_id: string;
  snapshot_id: string;
  attempt: number;
  status: PublicationStatus;
  layout_fingerprint: string;
  payload_checksum: string;
  cells_planned: number;
  cells_written: number;
  started_at: Date;
  finished_at: Date | null;
  error_code: string | null;
};

const SHA256 = /^[a-f0-9]{64}$/;

function mapTarget(row: TargetRow): SheetTarget {
  return {
    id: row.id,
    spreadsheetId: row.spreadsheet_id,
    expectedTitle: row.expected_title,
    status: row.status,
    layoutFingerprint: row.layout_fingerprint,
    validatedAt: row.validated_at,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
  };
}

function mapMapping(row: MappingRow): SheetLayoutMapping {
  return {
    id: row.id,
    targetId: row.target_id,
    reportKind: row.report_kind,
    logicalField: row.logical_field,
    sheetName: row.sheet_name,
    rangeA1: row.range_a1,
    valueType: row.value_type,
    required: row.required,
  };
}

function mapPublication(row: PublicationRow): SheetPublication {
  return {
    id: row.id,
    traceId: row.trace_id,
    targetId: row.target_id,
    snapshotId: row.snapshot_id,
    attempt: row.attempt,
    status: row.status,
    layoutFingerprint: row.layout_fingerprint,
    payloadChecksum: row.payload_checksum,
    cellsPlanned: row.cells_planned,
    cellsWritten: row.cells_written,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
  };
}

export type CreateSheetTargetInput = Readonly<{
  spreadsheetId: string;
  expectedTitle: string;
}>;

/** Registers a copy as a draft target; the protected original is refused. */
export async function createSheetTarget(
  db: Database,
  input: CreateSheetTargetInput,
): Promise<SheetTarget> {
  if (input.spreadsheetId === PROTECTED_SPREADSHEET_ID) {
    throw new AppError("E_SHEET_PROTECTED", 409);
  }
  if (input.spreadsheetId.trim().length < 10 || input.expectedTitle.trim() === "") {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<TargetRow[]>`
    insert into public.sheet_targets (spreadsheet_id, expected_title)
    values (${input.spreadsheetId}, ${input.expectedTitle})
    returning id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
  `;
  if (!row) throw new AppError("E_DB", 500);
  return mapTarget(row);
}

export async function markSheetTargetValidated(
  db: Database,
  targetId: string,
  layoutFingerprint: string,
  validatedAt = new Date(),
): Promise<SheetTarget> {
  if (!SHA256.test(layoutFingerprint)) throw new AppError("E_VALIDATION", 422);
  const [row] = await db<TargetRow[]>`
    update public.sheet_targets
    set status = 'validated', layout_fingerprint = ${layoutFingerprint},
      validated_at = ${validatedAt}
    where id = ${targetId} and status in ('draft', 'validated')
    returning id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapTarget(row);
}

/** Only one target may be active; activation is an explicit admin decision. */
export async function activateSheetTarget(
  db: Database,
  targetId: string,
  actorId: string,
  activatedAt = new Date(),
): Promise<SheetTarget> {
  return db.begin(async (transaction) => {
    await transaction`
      update public.sheet_targets set status = 'disabled'
      where status = 'active' and id <> ${targetId}
    `;
    const [row] = await transaction<TargetRow[]>`
      update public.sheet_targets
      set status = 'active', activated_by = ${actorId}, activated_at = ${activatedAt}
      where id = ${targetId} and status = 'validated' and layout_fingerprint is not null
      returning id, spreadsheet_id, expected_title, status, layout_fingerprint,
        validated_at, activated_by, activated_at
    `;
    if (!row) throw new AppError("E_CONFLICT", 409);
    return mapTarget(row);
  });
}

export async function listSheetTargets(db: Database): Promise<readonly SheetTarget[]> {
  const rows = await db<TargetRow[]>`
    select id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
    from public.sheet_targets
    order by created_at desc
  `;
  return rows.map(mapTarget);
}

export async function getSheetTarget(
  db: Database,
  targetId: string,
): Promise<SheetTarget | null> {
  const [row] = await db<TargetRow[]>`
    select id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
    from public.sheet_targets where id = ${targetId}
  `;
  return row ? mapTarget(row) : null;
}

/** A structural change disables the target: publication must never guess. */
export async function disableSheetTarget(
  db: Database,
  targetId: string,
): Promise<SheetTarget> {
  const [row] = await db<TargetRow[]>`
    update public.sheet_targets set status = 'disabled'
    where id = ${targetId} and status <> 'disabled'
    returning id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapTarget(row);
}

export async function getActiveSheetTarget(db: Database): Promise<SheetTarget | null> {
  const [row] = await db<TargetRow[]>`
    select id, spreadsheet_id, expected_title, status, layout_fingerprint,
      validated_at, activated_by, activated_at
    from public.sheet_targets where status = 'active'
  `;
  return row ? mapTarget(row) : null;
}

export type ReplaceLayoutMappingInput = Readonly<{
  reportKind: SheetReportKind;
  logicalField: string;
  sheetName: string;
  rangeA1: string;
  valueType: SheetValueType;
  required?: boolean | undefined;
}>;

/** Mappings are explicit: a range outside this list is never written. */
export async function replaceSheetLayoutMappings(
  db: Database,
  targetId: string,
  mappings: readonly ReplaceLayoutMappingInput[],
): Promise<readonly SheetLayoutMapping[]> {
  if (mappings.length === 0) throw new AppError("E_VALIDATION", 422);
  return db.begin(async (transaction) => {
    await transaction`delete from public.sheet_layout_mappings where target_id = ${targetId}`;
    const rows: MappingRow[] = [];
    for (const mapping of mappings) {
      const [row] = await transaction<MappingRow[]>`
        insert into public.sheet_layout_mappings (
          target_id, report_kind, logical_field, sheet_name, range_a1, value_type,
          required
        ) values (
          ${targetId}, ${mapping.reportKind}, ${mapping.logicalField},
          ${mapping.sheetName}, ${mapping.rangeA1}, ${mapping.valueType},
          ${mapping.required ?? true}
        )
        returning id, target_id, report_kind, logical_field, sheet_name, range_a1,
          value_type, required
      `;
      if (!row) throw new AppError("E_DB", 500);
      rows.push(row);
    }
    return rows.map(mapMapping);
  });
}

export async function listSheetLayoutMappings(
  db: Database,
  targetId: string,
): Promise<readonly SheetLayoutMapping[]> {
  const rows = await db<MappingRow[]>`
    select id, target_id, report_kind, logical_field, sheet_name, range_a1,
      value_type, required
    from public.sheet_layout_mappings
    where target_id = ${targetId}
    order by report_kind, logical_field
  `;
  return rows.map(mapMapping);
}

export type StartPublicationInput = Readonly<{
  traceId: string;
  targetId: string;
  snapshotId: string;
  attempt: number;
  layoutFingerprint: string;
  payloadChecksum: string;
  cellsPlanned: number;
}>;

export async function startSheetPublication(
  db: Database,
  input: StartPublicationInput,
): Promise<SheetPublication> {
  if (!SHA256.test(input.layoutFingerprint) || !SHA256.test(input.payloadChecksum)) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<PublicationRow[]>`
    insert into public.sheet_publications (
      trace_id, target_id, snapshot_id, attempt, layout_fingerprint,
      payload_checksum, cells_planned
    ) values (
      ${input.traceId}, ${input.targetId}, ${input.snapshotId}, ${input.attempt},
      ${input.layoutFingerprint}, ${input.payloadChecksum}, ${input.cellsPlanned}
    )
    returning id, trace_id, target_id, snapshot_id, attempt, status,
      layout_fingerprint, payload_checksum, cells_planned, cells_written,
      started_at, finished_at, error_code
  `;
  if (!row) throw new AppError("E_DB", 500);
  return mapPublication(row);
}

export type FinishPublicationInput = Readonly<{
  publicationId: string;
  status: Exclude<PublicationStatus, "running">;
  cellsWritten?: number;
  errorCode?: string | null;
  errorSummary?: string | null;
  finishedAt?: Date;
}>;

export async function finishSheetPublication(
  db: Database,
  input: FinishPublicationInput,
): Promise<SheetPublication> {
  const [row] = await db<PublicationRow[]>`
    update public.sheet_publications
    set status = ${input.status},
      cells_written = ${input.cellsWritten ?? 0},
      finished_at = ${input.finishedAt ?? new Date()},
      error_code = ${input.errorCode ?? null},
      error_summary = ${input.errorSummary ?? null}
    where id = ${input.publicationId} and status = 'running'
    returning id, trace_id, target_id, snapshot_id, attempt, status,
      layout_fingerprint, payload_checksum, cells_planned, cells_written,
      started_at, finished_at, error_code
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapPublication(row);
}

export async function getSuccessfulPublication(
  db: Database,
  targetId: string,
  snapshotId: string,
): Promise<SheetPublication | null> {
  const [row] = await db<PublicationRow[]>`
    select id, trace_id, target_id, snapshot_id, attempt, status,
      layout_fingerprint, payload_checksum, cells_planned, cells_written,
      started_at, finished_at, error_code
    from public.sheet_publications
    where target_id = ${targetId} and snapshot_id = ${snapshotId} and status = 'success'
  `;
  return row ? mapPublication(row) : null;
}

export async function listSheetPublications(
  db: Database,
  limit = 25,
): Promise<readonly SheetPublication[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("E_VALIDATION", 422);
  }
  const rows = await db<PublicationRow[]>`
    select id, trace_id, target_id, snapshot_id, attempt, status,
      layout_fingerprint, payload_checksum, cells_planned, cells_written,
      started_at, finished_at, error_code
    from public.sheet_publications
    order by started_at desc
    limit ${limit}
  `;
  return rows.map(mapPublication);
}
