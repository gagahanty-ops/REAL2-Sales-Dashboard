import type { SystemHealthInput } from "@real2/domain";

import type { Database } from "./client.js";

export type SystemStatusSnapshot = Omit<SystemHealthInput, "now" | "databaseReachable">;

/**
 * Collects the safe facts the health evaluator needs. Everything here is a
 * count, a flag or a timestamp: no credentials, no payloads, no personal data.
 */
export async function collectSystemStatus(
  db: Database,
): Promise<SystemStatusSnapshot> {
  const [row] = await db<{
    active_config: boolean;
    snapshot_version: string | null;
    snapshot_source_fresh_at: Date | null;
    last_successful_sync_at: Date | null;
    blocking_issues: number;
    token_expires_at: Date | null;
    publication_status: string | null;
    publication_error_code: string | null;
  }[]>`
    select
      exists(select 1 from public.pipeline_configs where is_active) as active_config,
      (
        select snapshots.version::text
        from public.current_snapshot as pointer
        join public.metric_snapshots as snapshots on snapshots.id = pointer.snapshot_id
        where pointer.singleton and snapshots.status in ('approved', 'published')
      ) as snapshot_version,
      (
        select snapshots.source_fresh_at
        from public.current_snapshot as pointer
        join public.metric_snapshots as snapshots on snapshots.id = pointer.snapshot_id
        where pointer.singleton and snapshots.status in ('approved', 'published')
      ) as snapshot_source_fresh_at,
      (
        select max(finished_at) from public.sync_runs where status = 'success'
      ) as last_successful_sync_at,
      (
        select count(*)::integer from public.data_quality_issues
        where status = 'open' and severity = 'blocking'
      ) as blocking_issues,
      (
        select max(token_expires_at) from public.amo_connections where status = 'active'
      ) as token_expires_at,
      (
        select status::text from public.sheet_publications
        order by started_at desc limit 1
      ) as publication_status,
      (
        select error_code from public.sheet_publications
        order by started_at desc limit 1
      ) as publication_error_code
  `;

  const consecutiveFailures = await countConsecutiveSyncFailures(db);

  return {
    activeConfig: row?.active_config === true,
    currentSnapshot: row?.snapshot_version && row.snapshot_source_fresh_at
      ? {
          version: Number(row.snapshot_version),
          sourceFreshAt: row.snapshot_source_fresh_at,
        }
      : null,
    lastSuccessfulSyncAt: row?.last_successful_sync_at ?? null,
    consecutiveSyncFailures: consecutiveFailures,
    openBlockingQualityIssues: row?.blocking_issues ?? 0,
    lastPublication: row?.publication_status
      ? {
          status: row.publication_status,
          errorCode: row.publication_error_code ?? null,
        }
      : null,
    amoTokenExpiresAt: row?.token_expires_at ?? null,
  };
}

/** Counts finished runs that failed in a row, newest first. */
async function countConsecutiveSyncFailures(db: Database): Promise<number> {
  const rows = await db<{ status: string }[]>`
    select status::text from public.sync_runs
    where finished_at is not null
    order by finished_at desc
    limit 20
  `;
  let failures = 0;
  for (const row of rows) {
    if (row.status === "success") break;
    failures += 1;
  }
  return failures;
}

export async function isDatabaseReachable(db: Database): Promise<boolean> {
  try {
    await db`select 1 as ok`;
    return true;
  } catch {
    return false;
  }
}
