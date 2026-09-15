import { AppError } from "@real2/domain";

import type { Database } from "./client.js";
import type {
  SyncCursorPosition,
  SyncKind,
  SyncStatus,
  SyncStream,
} from "./sync-runs.js";

export type SafeSyncRunSummary = Readonly<{
  id: string;
  traceId: string;
  kind: SyncKind;
  status: SyncStatus;
  startedAt: Date;
  finishedAt: Date | null;
  counts: Readonly<{
    pages: number;
    leads: number;
    events: number;
    users: number;
    retries: number;
  }>;
  errorCode: string | null;
  errorSummary: string | null;
}>;

export type SafeSyncRunDetail = SafeSyncRunSummary & Readonly<{
  pages: readonly Readonly<{
    stream: SyncStream;
    pageNumber: number;
    itemCount: number;
    receivedAt: Date;
  }>[];
  audit: readonly Readonly<{
    method: string;
    normalizedPath: string;
    responseStatus: number | null;
    result: string;
    requestCount: number;
    totalDurationMs: number;
    maxAttempt: number;
  }>[];
}>;

type SafeSyncRunRow = {
  id: string;
  trace_id: string;
  kind: SyncKind;
  status: SyncStatus;
  started_at: Date;
  finished_at: Date | null;
  pages_read: number;
  leads_read: number;
  events_read: number;
  users_read: number;
  retries: number;
  error_code: string | null;
  error_summary: string | null;
};

function mapSafeRun(row: SafeSyncRunRow): SafeSyncRunSummary {
  return {
    id: row.id,
    traceId: row.trace_id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: {
      pages: row.pages_read,
      leads: row.leads_read,
      events: row.events_read,
      users: row.users_read,
      retries: row.retries,
    },
    errorCode: row.error_code,
    errorSummary: row.error_summary,
  };
}

export type RawRetentionSourceTable =
  | "raw_amo_objects"
  | "raw_amo_events"
  | "raw_amo_quarantine";

export type RawRetentionProofInput = Readonly<{
  sourceTable: RawRetentionSourceTable;
  sourceId: string;
  payloadSha256: string;
  normalizedEntityType: string;
  normalizedEntityId: string;
  provedAt?: Date;
}>;

export type RawRetentionResult = Readonly<{
  objectsDeleted: number;
  eventsDeleted: number;
  quarantineDeleted: number;
  hashesPreserved: number;
  normalizedRowsVerified: number;
}>;

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export async function withSyncAdvisoryLock<T>(
  db: Database,
  connectionId: string,
  action: () => Promise<T>,
): Promise<T> {
  const reserved = await db.reserve();
  let locked = false;
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(
        hashtextextended(${`${connectionId}:sync`}, 0)
      ) as locked
    `;
    locked = row?.locked === true;
    if (!locked) throw new AppError("E_SYNC_LOCKED", 409);
    return await action();
  } finally {
    if (locked) {
      await reserved`
        select pg_advisory_unlock(
          hashtextextended(${`${connectionId}:sync`}, 0)
        )
      `;
    }
    reserved.release();
  }
}

export async function getSyncCursors(
  db: Database,
  connectionId: string,
): Promise<Partial<Record<SyncStream, SyncCursorPosition>>> {
  const rows = await db<{
    stream: SyncStream;
    cursor_time: Date | null;
    cursor_external_id: string | null;
  }[]>`
    select stream, cursor_time, cursor_external_id
    from public.sync_cursors
    where connection_id = ${connectionId}
    order by stream
  `;
  return Object.fromEntries(rows.map((row) => [
    row.stream,
    { cursorTime: row.cursor_time, cursorExternalId: row.cursor_external_id },
  ]));
}

export async function getPreviousFullLeadCount(
  db: Database,
  connectionId: string,
): Promise<number | null> {
  const [row] = await db<{ leads_read: number }[]>`
    select leads_read
    from public.sync_runs
    where connection_id = ${connectionId}
      and status = 'success'
      and kind in ('initial_backfill', 'nightly_reconciliation', 'manual')
    order by finished_at desc, id desc
    limit 1
  `;
  return row?.leads_read ?? null;
}

export async function failStaleSyncRuns(
  db: Database,
  cutoff: Date,
  finishedAt: Date,
): Promise<readonly string[]> {
  const rows = await db<{ id: string }[]>`
    select id from app.fail_stale_sync_runs(${cutoff}, ${finishedAt}) as id
  `;
  return rows.map((row) => row.id);
}

export async function recordRawRetentionProofs(
  db: Database,
  proofs: readonly RawRetentionProofInput[],
): Promise<void> {
  for (const proof of proofs) {
    if (
      !isSha256(proof.payloadSha256) ||
      proof.normalizedEntityType.length < 1 ||
      proof.normalizedEntityType.length > 80 ||
      proof.normalizedEntityId.length < 1 ||
      proof.normalizedEntityId.length > 128
    ) {
      throw new AppError("E_VALIDATION", 422);
    }
    const inserted = await db<{ source_id: string }[]>`
      insert into public.raw_retention_proofs (
        source_table,
        source_id,
        payload_sha256,
        normalized_entity_type,
        normalized_entity_id,
        proved_at
      ) values (
        ${proof.sourceTable},
        ${proof.sourceId},
        ${proof.payloadSha256},
        ${proof.normalizedEntityType},
        ${proof.normalizedEntityId},
        ${proof.provedAt ?? new Date()}
      )
      on conflict (source_table, source_id) do nothing
      returning source_id
    `;
    if (inserted.length > 0) continue;
    const [existing] = await db<{
      payload_sha256: string;
      normalized_entity_type: string;
      normalized_entity_id: string;
    }[]>`
      select payload_sha256, normalized_entity_type, normalized_entity_id
      from public.raw_retention_proofs
      where source_table = ${proof.sourceTable}
        and source_id = ${proof.sourceId}
    `;
    if (
      !existing ||
      existing.payload_sha256 !== proof.payloadSha256 ||
      existing.normalized_entity_type !== proof.normalizedEntityType ||
      existing.normalized_entity_id !== proof.normalizedEntityId
    ) {
      throw new AppError("E_CONFLICT", 409);
    }
  }
}

export async function deleteProvenRawBefore(
  db: Database,
  cutoff: Date,
): Promise<RawRetentionResult> {
  const [row] = await db<{
    objects_deleted: number;
    events_deleted: number;
    quarantine_deleted: number;
    hashes_preserved: number;
    normalized_rows_verified: number;
  }[]>`
    select * from app.delete_proven_raw_before(${cutoff})
  `;
  if (!row) throw new AppError("E_DB", 500);
  return {
    objectsDeleted: row.objects_deleted,
    eventsDeleted: row.events_deleted,
    quarantineDeleted: row.quarantine_deleted,
    hashesPreserved: row.hashes_preserved,
    normalizedRowsVerified: row.normalized_rows_verified,
  };
}

const safeRunColumns = `
  id, trace_id, kind, status, started_at, finished_at,
  pages_read, leads_read, events_read, users_read, retries,
  error_code, error_summary
`;

export async function listSyncRuns(
  db: Database,
  input: Readonly<{ page: number; pageSize: number }>,
): Promise<Readonly<{
  items: readonly SafeSyncRunSummary[];
  page: number;
  pageSize: number;
  total: number;
}>> {
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
  const offset = (input.page - 1) * input.pageSize;
  const rows = await db.unsafe<SafeSyncRunRow[]>(
    `select ${safeRunColumns}
     from public.sync_runs
     order by started_at desc, id desc
     limit $1 offset $2`,
    [input.pageSize, offset],
  );
  const [count] = await db<{ total: number }[]>`
    select count(*)::integer as total from public.sync_runs
  `;
  return {
    items: rows.map(mapSafeRun),
    page: input.page,
    pageSize: input.pageSize,
    total: count?.total ?? 0,
  };
}

export async function getLatestSyncRun(
  db: Database,
): Promise<SafeSyncRunSummary | null> {
  const rows = await db.unsafe<SafeSyncRunRow[]>(
    `select ${safeRunColumns}
     from public.sync_runs
     order by started_at desc, id desc
     limit 1`,
  );
  return rows[0] ? mapSafeRun(rows[0]) : null;
}

export async function getSyncRunDetail(
  db: Database,
  runId: string,
): Promise<SafeSyncRunDetail | null> {
  const runs = await db.unsafe<SafeSyncRunRow[]>(
    `select ${safeRunColumns}
     from public.sync_runs
     where id = $1::uuid
     limit 1`,
    [runId],
  );
  const run = runs[0];
  if (!run) return null;
  const pages = await db<{
    stream: SyncStream;
    page_number: number;
    item_count: number;
    received_at: Date;
  }[]>`
    select stream, page_number, item_count, received_at
    from public.sync_pages
    where sync_run_id = ${runId}
    order by received_at, stream, page_number
  `;
  const audit = await db<{
    method: string;
    normalized_path: string;
    response_status: number | null;
    result: string;
    request_count: number;
    total_duration_ms: number;
    max_attempt: number;
  }[]>`
    select
      method,
      normalized_path,
      response_status,
      result,
      count(*)::integer as request_count,
      sum(duration_ms)::integer as total_duration_ms,
      max(attempt)::integer as max_attempt
    from public.amo_api_audit
    where sync_run_id = ${runId}
    group by method, normalized_path, response_status, result
    order by normalized_path, method, response_status nulls last, result
  `;
  return {
    ...mapSafeRun(run),
    pages: pages.map((page) => ({
      stream: page.stream,
      pageNumber: page.page_number,
      itemCount: page.item_count,
      receivedAt: page.received_at,
    })),
    audit: audit.map((entry) => ({
      method: entry.method,
      normalizedPath: entry.normalized_path,
      responseStatus: entry.response_status,
      result: entry.result,
      requestCount: entry.request_count,
      totalDurationMs: entry.total_duration_ms,
      maxAttempt: entry.max_attempt,
    })),
  };
}
