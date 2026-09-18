import { AppError } from "@real2/domain";
import type { TransactionSql } from "postgres";

import type { Database } from "../client.js";

export type SnapshotMeta = Readonly<{
  id: string;
  version: number;
  generatedAt: Date;
  sourceFreshAt: Date;
  qualitySummary: Readonly<Record<string, number>>;
}>;

type SnapshotMetaRow = {
  id: string;
  version: string;
  generated_at: Date;
  source_fresh_at: Date;
  quality_summary: Record<string, number>;
};

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError("E_DB", 500);
  return parsed;
}

/**
 * Runs one dashboard read inside a read-only transaction pinned to the current
 * approved snapshot. Every block of a response therefore shares one immutable
 * version even when a new snapshot is approved mid-request (SPEC M7.5).
 */
export async function withCurrentSnapshot<T>(
  db: Database,
  query: (transaction: TransactionSql, snapshot: SnapshotMeta) => Promise<T>,
): Promise<Readonly<{ data: T; snapshot: SnapshotMeta }>> {
  return db.begin(async (transaction) => {
    await transaction`set transaction read only`;
    const [row] = await transaction<SnapshotMetaRow[]>`
      select snapshots.id, snapshots.version, snapshots.generated_at,
        snapshots.source_fresh_at, snapshots.quality_summary
      from public.current_snapshot as pointer
      join public.metric_snapshots as snapshots on snapshots.id = pointer.snapshot_id
      where pointer.singleton
        and snapshots.status in ('approved', 'published')
    `;
    if (!row) {
      // No approved snapshot means initial setup, not an empty report.
      throw new AppError("E_CONFIG_INCOMPLETE", 503);
    }
    const snapshot: SnapshotMeta = {
      id: row.id,
      version: safeInteger(row.version),
      generatedAt: row.generated_at,
      sourceFreshAt: row.source_fresh_at,
      qualitySummary: row.quality_summary,
    };
    return { data: await query(transaction, snapshot), snapshot };
  });
}
