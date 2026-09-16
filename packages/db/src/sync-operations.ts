import { randomUUID } from "node:crypto";

import { AppError, type AppErrorCode } from "@real2/domain";

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
  correlationTraceId: string | null;
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
  createdBy: string | null;
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
  correlation_trace_id: string | null;
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
  created_by: string | null;
};

function mapSafeRun(row: SafeSyncRunRow): SafeSyncRunSummary {
  return {
    id: row.id,
    traceId: row.trace_id,
    correlationTraceId: row.correlation_trace_id,
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
    createdBy: row.created_by,
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

export type QueuedSyncWork = Readonly<{ id: string; traceId: string; kind: SyncKind }>;

export type ClaimedSyncWork = QueuedSyncWork &
  Readonly<{
    requestedBy: string | null;
    leaseToken: string;
    attempt: number;
  }>;

export type CompleteSyncWorkInput = Readonly<{
  id: string;
  leaseToken: string;
  status: "done" | "failed";
  completedAt: Date;
  syncRunId?: string | null;
  errorCode?: AppErrorCode | string | null;
  errorSummary?: string | null;
}>;

export type SyncLockFence = Readonly<{
  backendPid: number;
  assertOwned(): Promise<void>;
}>;

const queueExhaustedCode: AppErrorCode = "E_SYNC_QUEUE_EXHAUSTED";
const queueExhaustedSummary = "Queued synchronization exceeded retry attempts";

export async function enqueueSyncWork(
  db: Database,
  input: Readonly<{ traceId: string; kind: SyncKind; requestedBy: string | null }>,
): Promise<QueuedSyncWork> {
  const [row] = await db<{ id: string; trace_id: string; kind: SyncKind }[]>`
    insert into public.sync_work_queue (trace_id, kind, requested_by)
    values (${input.traceId}, ${input.kind}, ${input.requestedBy})
    returning id, trace_id, kind
  `;
  if (!row) throw new AppError("E_DB", 500);
  return { id: row.id, traceId: row.trace_id, kind: row.kind };
}

export async function claimNextSyncWork(
  db: Database,
  input: Readonly<{ now: Date; leaseMs: number; maxAttempts?: number }>,
): Promise<ClaimedSyncWork | null> {
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
    throw new AppError("E_VALIDATION", 422);
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new AppError("E_VALIDATION", 422);
  }
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
  return db.begin(async (transaction) => {
    await sweepExpiredSyncWorkWithClient(transaction, {
      now: input.now,
      maxAttempts,
    });
    const [selected] = await transaction<{ id: string }[]>`
      select id
      from public.sync_work_queue
      where status in ('queued', 'running')
        and attempt_count < ${maxAttempts}
        and (
          status = 'queued'
          or (status = 'running' and lease_expires_at <= ${input.now})
        )
      order by requested_at, id
      for update skip locked
      limit 1
    `;
    if (!selected) return null;
    const [claimed] = await transaction<{
      id: string;
      trace_id: string;
      kind: SyncKind;
      requested_by: string | null;
      lease_token: string;
      attempt_count: number;
    }[]>`
      update public.sync_work_queue
      set
        status = 'running',
        claimed_at = ${input.now},
        completed_at = null,
        lease_token = ${leaseToken},
        lease_expires_at = ${leaseExpiresAt},
        attempt_count = attempt_count + 1,
        last_error_code = null,
        last_error_summary = null
      where id = ${selected.id}
      returning id, trace_id, kind, requested_by, lease_token, attempt_count
    `;
    if (!claimed) throw new AppError("E_DB", 500);
    return {
      id: claimed.id,
      traceId: claimed.trace_id,
      kind: claimed.kind,
      requestedBy: claimed.requested_by,
      leaseToken: claimed.lease_token,
      attempt: claimed.attempt_count,
    };
  });
}

type SyncWorkQueueClient = Pick<Database, "unsafe">;

async function sweepExpiredSyncWorkWithClient(
  db: SyncWorkQueueClient,
  input: Readonly<{ now: Date; maxAttempts: number }>,
): Promise<number> {
  const rows = await db.unsafe<{ id: string }[]>(
    `
    update public.sync_work_queue
    set
      status = 'failed',
      completed_at = $1,
      lease_token = coalesce(lease_token, gen_random_uuid()),
      last_error_code = $2,
      last_error_summary = $3
    where (
      status = 'running'
      and lease_expires_at <= $1
      and attempt_count >= $4
    ) or (
      status = 'queued'
      and attempt_count >= $4
    )
    returning id
    `,
    [input.now, queueExhaustedCode, queueExhaustedSummary, input.maxAttempts],
  );
  return rows.length;
}

export async function sweepExpiredSyncWork(
  db: Database,
  input: Readonly<{ now: Date; maxAttempts?: number }>,
): Promise<number> {
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new AppError("E_VALIDATION", 422);
  }
  return sweepExpiredSyncWorkWithClient(db, { now: input.now, maxAttempts });
}

export async function completeSyncWork(
  db: Database,
  input: CompleteSyncWorkInput,
): Promise<void> {
  if (input.errorSummary && input.errorSummary.length > 500) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<{ id: string }[]>`
    update public.sync_work_queue
    set
      status = ${input.status},
      completed_at = ${input.completedAt},
      sync_run_id = ${input.syncRunId ?? null},
      last_error_code = ${input.errorCode ?? null},
      last_error_summary = ${input.errorSummary ?? null}
    where id = ${input.id}
      and lease_token = ${input.leaseToken}
      and status = 'running'
    returning id
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export async function withSyncAdvisoryLock<T>(
  db: Database,
  connectionId: string,
  action: (fence: SyncLockFence) => Promise<T>,
): Promise<T> {
  const reserved = await db.reserve();
  let locked = false;
  let backendPid: number | null = null;
  let lockSessionLost = false;
  try {
    const [backend] = await reserved<{ pid: number }[]>`
      select pg_backend_pid() as pid
    `;
    if (!backend) throw new AppError("E_DB", 500);
    backendPid = backend.pid;
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(
        hashtextextended(${`${connectionId}:sync`}, 0)
      ) as locked
    `;
    locked = row?.locked === true;
    if (!locked) throw new AppError("E_SYNC_LOCKED", 409);
    const fence: SyncLockFence = {
      backendPid,
      async assertOwned() {
        let timeout: NodeJS.Timeout | undefined;
        try {
          const heartbeat = reserved<{ pid: number }[]>`
            select pg_backend_pid() as pid
          `;
          const [current] = await Promise.race([
            heartbeat,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                reject(new AppError("E_SYNC_FENCE_LOST", 409));
              }, 1_000);
            }),
          ]);
          if (!current || current.pid !== backendPid) {
            throw new AppError("E_SYNC_FENCE_LOST", 409);
          }
        } catch (error) {
          lockSessionLost = true;
          if (error instanceof AppError) throw error;
          throw new AppError("E_SYNC_FENCE_LOST", 409);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      },
    };
    return await action(fence);
  } finally {
    if (locked && !lockSessionLost) {
      try {
        await reserved`
          select pg_advisory_unlock(
            hashtextextended(${`${connectionId}:sync`}, 0)
          )
        `;
      } catch {
        // A terminated session has already released its advisory locks.
      }
    }
    reserved.release();
  }
}

export async function isSyncAdvisoryLockBusy(
  db: Database,
  connectionId: string,
): Promise<boolean> {
  const reserved = await db.reserve();
  let locked = false;
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(
        hashtextextended(${`${connectionId}:sync`}, 0)
      ) as locked
    `;
    locked = row?.locked === true;
    return !locked;
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
  id, trace_id, correlation_trace_id, kind, status, started_at, finished_at,
  pages_read, leads_read, events_read, users_read, retries,
  error_code, error_summary, created_by
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
