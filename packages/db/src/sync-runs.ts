import { AppError } from "@real2/domain";

import type { Database } from "./client.js";

export type SyncKind =
  | "initial_backfill"
  | "incremental"
  | "nightly_reconciliation"
  | "manual";
export type SyncStatus = "running" | "success" | "partial" | "failed";
export type SyncStream = "leads" | "events" | "users" | "metadata";

export type SyncCounts = Readonly<{
  pagesRead: number;
  leadsRead: number;
  eventsRead: number;
  usersRead: number;
  retries: number;
}>;

export type SyncCursorPosition = Readonly<{
  cursorTime: Date | null;
  cursorExternalId: string | null;
}>;

export type SyncOutcome =
  | Readonly<{
      status: "success";
      nextCursors: Partial<Record<SyncStream, SyncCursorPosition>>;
      counts: SyncCounts;
      sourceMaxUpdatedAt?: Date | null;
      checksum?: string | null;
    }>
  | Readonly<{
      status: "partial" | "failed";
      safeError: string;
      errorCode?: string | null;
      counts: SyncCounts;
      sourceMaxUpdatedAt?: Date | null;
      checksum?: string | null;
    }>;

export type StartSyncRunInput = Readonly<{
  traceId: string;
  connectionId: string;
  configId: string;
  kind: SyncKind;
  createdBy?: string | null;
  startedAt?: Date;
}>;

export type SyncRun = Readonly<{
  id: string;
  traceId: string;
  connectionId: string;
  configId: string;
  kind: SyncKind;
  status: SyncStatus;
  startedAt: Date;
}>;

type SyncRunRow = {
  id: string;
  trace_id: string;
  connection_id: string;
  config_id: string;
  kind: SyncKind;
  status: SyncStatus;
  started_at: Date;
};

const streams: readonly SyncStream[] = ["metadata", "users", "events", "leads"];
function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateCounts(counts: SyncCounts): void {
  if (
    !isNonNegativeInteger(counts.pagesRead) ||
    !isNonNegativeInteger(counts.leadsRead) ||
    !isNonNegativeInteger(counts.eventsRead) ||
    !isNonNegativeInteger(counts.usersRead) ||
    !isNonNegativeInteger(counts.retries)
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
}

function mapRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    traceId: row.trace_id,
    connectionId: row.connection_id,
    configId: row.config_id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
  };
}

export async function startSyncRun(
  db: Database,
  input: StartSyncRunInput,
): Promise<SyncRun> {
  const [row] = await db<SyncRunRow[]>`
    insert into public.sync_runs (
      trace_id,
      connection_id,
      config_id,
      kind,
      started_at,
      created_by
    ) values (
      ${input.traceId},
      ${input.connectionId},
      ${input.configId},
      ${input.kind},
      ${input.startedAt ?? new Date()},
      ${input.createdBy ?? null}
    )
    returning id, trace_id, connection_id, config_id, kind, status, started_at
  `;
  if (!row) throw new AppError("E_DB", 500);
  return mapRun(row);
}

function serializeCursors(
  nextCursors: Partial<Record<SyncStream, SyncCursorPosition>>,
): Record<string, { cursor_time: string | null; cursor_external_id: string | null }> {
  const serialized: Record<
    string,
    { cursor_time: string | null; cursor_external_id: string | null }
  > = {};
  for (const stream of streams) {
    const cursor = nextCursors[stream];
    if (!cursor) continue;
    if (
      cursor.cursorExternalId !== null &&
      (typeof cursor.cursorExternalId !== "string" ||
        cursor.cursorExternalId.length < 1 ||
        cursor.cursorExternalId.length > 128)
    ) {
      throw new AppError("E_VALIDATION", 422);
    }
    serialized[stream] = {
      cursor_time: cursor.cursorTime?.toISOString() ?? null,
      cursor_external_id: cursor.cursorExternalId,
    };
  }
  return serialized;
}

export async function finishSyncRun(
  db: Database,
  runId: string,
  outcome: SyncOutcome,
  finishedAt = new Date(),
): Promise<void> {
  validateCounts(outcome.counts);
  if (outcome.status !== "success" && outcome.safeError.length > 500) {
    throw new AppError("E_VALIDATION", 422);
  }

  const errorCode = outcome.status === "success" ? null : outcome.errorCode ?? null;
  const errorSummary = outcome.status === "success" ? null : outcome.safeError;
  const nextCursors =
    outcome.status === "success" ? serializeCursors(outcome.nextCursors) : {};
  const [row] = await db<{ result: "finished" | "not_found" | "conflict" }[]>`
    select app.finish_sync_run(
      ${runId}::uuid,
      ${outcome.status}::public.sync_status,
      ${finishedAt},
      ${outcome.counts.pagesRead},
      ${outcome.counts.leadsRead},
      ${outcome.counts.eventsRead},
      ${outcome.counts.usersRead},
      ${outcome.counts.retries},
      ${outcome.sourceMaxUpdatedAt ?? null},
      ${errorCode},
      ${errorSummary},
      ${outcome.checksum ?? null},
      ${db.json(nextCursors)}
    ) as result
  `;
  if (!row || row.result === "not_found") throw new AppError("E_NOT_FOUND", 404);
  if (row.result === "conflict") throw new AppError("E_CONFLICT", 409);
}
