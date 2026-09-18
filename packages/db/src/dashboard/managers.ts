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

export type ManagerMetricRow = Readonly<{
  managerKey: string;
  managerName: string;
  totals: MetricTotals;
}>;

export type ManagerMetrics = Readonly<{
  rows: readonly ManagerMetricRow[];
  totals: MetricTotals;
}>;

export async function getManagerMetrics(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: Readonly<{ filters: DashboardQueryFilters; scope: DashboardQueryScope }>,
): Promise<ManagerMetrics> {
  const cells = await selectCells(
    transaction,
    snapshot,
    input.filters,
    input.scope,
    { byManager: true },
  );

  const grouped = new Map<string, CellRow[]>();
  for (const cell of cells) {
    grouped.set(cell.managerKey, [...(grouped.get(cell.managerKey) ?? []), cell]);
  }

  const names = new Map<string, string>();
  const amoUserIds = [...grouped.keys()]
    .filter((key) => key !== "unassigned")
    .map((key) => Number(key));
  if (amoUserIds.length > 0) {
    const rows = await transaction<{ amo_user_id: string; name: string }[]>`
      select amo_user_id, name from public.amo_users
      where amo_user_id = any(${amoUserIds})
    `;
    for (const row of rows) names.set(row.amo_user_id, row.name);
  }

  const rows = [...grouped.entries()]
    .sort(([left], [right]) => {
      if (left === "unassigned") return 1;
      if (right === "unassigned") return -1;
      return Number(left) - Number(right);
    })
    .map(([managerKey, managerCells]) => ({
      managerKey,
      managerName: managerKey === "unassigned"
        ? "Без ответственного"
        : names.get(managerKey) ?? `Пользователь ${managerKey}`,
      totals: sumTotals(managerCells),
    }));

  return { rows, totals: sumTotals(cells) };
}
