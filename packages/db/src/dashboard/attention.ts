import type { TransactionSql } from "postgres";

import { getDrilldown } from "./drilldown.js";
import type { DashboardQueryFilters, DashboardQueryScope } from "./cells.js";
import type { SnapshotMeta } from "./with-snapshot.js";
import type { DrilldownRow } from "@real2/domain";

export type AttentionResult = Readonly<{
  /** Open issue counts of the leads inside the current slice. */
  counters: Readonly<Record<string, number>>;
  rows: readonly DrilldownRow[];
}>;

/**
 * Leads that need a human decision: everything in the current slice that
 * carries at least one open quality code, with counts by code.
 */
export async function getAttention(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: Readonly<{
    filters: DashboardQueryFilters;
    scope: DashboardQueryScope;
    limit?: number;
  }>,
): Promise<AttentionResult> {
  const page = await getDrilldown(transaction, snapshot, {
    filters: input.filters,
    scope: input.scope,
    metric: "quality_issue",
    limit: input.limit ?? 100,
  });

  const counters: Record<string, number> = {};
  for (const row of page.rows) {
    for (const code of row.quality) {
      counters[code] = (counters[code] ?? 0) + 1;
    }
  }

  return { counters, rows: page.rows };
}
