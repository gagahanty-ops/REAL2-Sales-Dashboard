import { AppError } from "@real2/domain";
import type { TransactionSql } from "postgres";

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
  cursorExternalId: number | null;
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

async function replaceCursors(
  transaction: TransactionSql,
  connectionId: string,
  runId: string,
  nextCursors: Partial<Record<SyncStream, SyncCursorPosition>>,
  updatedAt: Date,
): Promise<void> {
  for (const stream of streams) {
    const cursor = nextCursors[stream];
    if (!cursor) continue;
    if (
      cursor.cursorExternalId !== null &&
      (!Number.isSafeInteger(cursor.cursorExternalId) || cursor.cursorExternalId <= 0)
    ) {
      throw new AppError("E_VALIDATION", 422);
    }
    await transaction`
      insert into public.sync_cursors (
        connection_id,
        stream,
        cursor_time,
        cursor_external_id,
        last_successful_run_id,
        updated_at
      ) values (
        ${connectionId},
        ${stream},
        ${cursor.cursorTime},
        ${cursor.cursorExternalId},
        ${runId},
        ${updatedAt}
      )
      on conflict (connection_id, stream) do update set
        cursor_time = excluded.cursor_time,
        cursor_external_id = excluded.cursor_external_id,
        last_successful_run_id = excluded.last_successful_run_id,
        updated_at = excluded.updated_at
    `;
  }
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

  await db.begin(async (transaction) => {
    const [run] = await transaction<{
      connection_id: string;
      status: SyncStatus;
    }[]>`
      select connection_id, status
      from public.sync_runs
      where id = ${runId}
      for update
    `;
    if (!run) throw new AppError("E_NOT_FOUND", 404);
    if (run.status !== "running") throw new AppError("E_CONFLICT", 409);

    const errorCode = outcome.status === "success" ? null : outcome.errorCode ?? null;
    const errorSummary = outcome.status === "success" ? null : outcome.safeError;
    await transaction`
      update public.sync_runs
      set
        status = ${outcome.status},
        finished_at = ${finishedAt},
        pages_read = ${outcome.counts.pagesRead},
        leads_read = ${outcome.counts.leadsRead},
        events_read = ${outcome.counts.eventsRead},
        users_read = ${outcome.counts.usersRead},
        retries = ${outcome.counts.retries},
        source_max_updated_at = ${outcome.sourceMaxUpdatedAt ?? null},
        error_code = ${errorCode},
        error_summary = ${errorSummary},
        checksum = ${outcome.checksum ?? null}
      where id = ${runId}
    `;

    if (outcome.status === "success") {
      await replaceCursors(
        transaction,
        run.connection_id,
        runId,
        outcome.nextCursors,
        finishedAt,
      );
    }
  });
}
