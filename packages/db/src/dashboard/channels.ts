import type { MetricTotals } from "@real2/domain";
import type { TransactionSql } from "postgres";

import {
  selectCells,
  sumTotals,
  type CellRow,
  type DashboardQueryFilters,
  type DashboardQueryScope,
} from "./cells.js";
import type { SnapshotMeta } from "./with-snapshot.js";

export type ChannelMetricRow = Readonly<{ channel: string; totals: MetricTotals }>;

export type ChannelMetrics = Readonly<{
  rows: readonly ChannelMetricRow[];
  totals: MetricTotals;
}>;

export async function getChannelMetrics(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: Readonly<{ filters: DashboardQueryFilters; scope: DashboardQueryScope }>,
): Promise<ChannelMetrics> {
  const cells = await selectCells(
    transaction,
    snapshot,
    input.filters,
    input.scope,
    { byChannel: true },
  );

  const grouped = new Map<string, CellRow[]>();
  for (const cell of cells) {
    grouped.set(cell.channelKey, [...(grouped.get(cell.channelKey) ?? []), cell]);
  }

  const rows = [...grouped.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([channel, channelCells]) => ({ channel, totals: sumTotals(channelCells) }));

  return { rows, totals: sumTotals(cells) };
}
