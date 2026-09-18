import type { TransactionSql } from "postgres";

import {
  formatKopecks,
  kopecks,
  scopedManagerKeys,
  type DashboardQueryFilters,
  type DashboardQueryScope,
} from "./cells.js";
import type { SnapshotMeta } from "./with-snapshot.js";

export type FunnelStage = Readonly<{
  statusId: number;
  statusName: string;
  openCount: number;
  openAmountRub: string;
  /** Null when the scope spans several managers: a median of medians is not a median. */
  medianAgeSeconds: number | null;
  averageAgeSeconds: number | null;
}>;

export type FunnelMetrics = Readonly<{ stages: readonly FunnelStage[] }>;

type StageRow = {
  status_id: string;
  status_name: string;
  manager_key: string;
  open_count: number;
  open_amount: string;
  median_age_seconds: string | null;
  average_age_seconds: string | null;
};

export async function getFunnelMetrics(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: Readonly<{ scope: DashboardQueryScope; filters?: DashboardQueryFilters }>,
): Promise<FunnelMetrics> {
  const managerKeys = scopedManagerKeys(
    input.filters ?? {
      from: "1970-01-01",
      to: "1970-01-01",
      channels: [],
      managerIds: [],
      includeUnassigned: false,
      allManagers: true,
      compare: false,
    },
    input.scope,
  );

  const rows = await transaction<StageRow[]>`
    select status_id, status_name, manager_key, open_count, open_amount,
      median_age_seconds, average_age_seconds
    from public.stage_snapshot_rows
    where snapshot_id = ${snapshot.id}
      and (
        ${managerKeys.length === 0}::boolean is true
        or manager_key = any(${managerKeys as string[]})
      )
    order by status_id, manager_key
  `;

  const grouped = new Map<string, StageRow[]>();
  for (const row of rows) {
    grouped.set(row.status_id, [...(grouped.get(row.status_id) ?? []), row]);
  }

  const stages = [...grouped.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([statusId, statusRows]) => {
      const openCount = statusRows.reduce((sum, row) => sum + row.open_count, 0);
      const amount = statusRows.reduce((sum, row) => sum + kopecks(row.open_amount), 0n);
      const single = statusRows.length === 1 ? statusRows[0] : undefined;
      const weightedAverage = openCount === 0
        ? null
        : Math.round(
            statusRows.reduce(
              (sum, row) => sum + Number(row.average_age_seconds ?? 0) * row.open_count,
              0,
            ) / openCount,
          );
      return {
        statusId: Number(statusId),
        statusName: statusRows[0]?.status_name ?? `Статус ${statusId}`,
        openCount,
        openAmountRub: formatKopecks(amount),
        medianAgeSeconds: single?.median_age_seconds == null
          ? null
          : Number(single.median_age_seconds),
        averageAgeSeconds: single?.average_age_seconds == null
          ? weightedAverage
          : Number(single.average_age_seconds),
      };
    });

  return { stages };
}
