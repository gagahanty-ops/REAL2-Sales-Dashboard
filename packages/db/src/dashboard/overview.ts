import {
  deltaPct,
  eachDate,
  evaluateQualityGate,
  previousPeriod,
  type DailyPoint,
  type MetricDelta,
  type MetricTotals,
  type PlanProgress,
} from "@real2/domain";
import type { TransactionSql } from "postgres";

import {
  formatKopecks,
  selectCells,
  sumTotals,
  type DashboardQueryFilters,
  type DashboardQueryScope,
} from "./cells.js";
import type { SnapshotMeta } from "./with-snapshot.js";

const STALE_AFTER_MS = 10 * 60_000;

export type DashboardOverviewData = Readonly<{
  totals: MetricTotals;
  previous: MetricTotals | null;
  deltas: MetricDelta | null;
  daily: readonly DailyPoint[];
  plans: readonly PlanProgress[];
  quality: Readonly<{
    counters: Readonly<Record<string, number>>;
    approved: boolean;
    blockingCodes: readonly string[];
  }>;
  /** True when the last successful sync ended more than ten minutes ago. */
  stale: boolean;
}>;

export type OverviewInput = Readonly<{
  filters: DashboardQueryFilters;
  scope: DashboardQueryScope;
  now: Date;
}>;

const PLAN_METRICS = ["leads_created", "applications", "payments", "revenue"] as const;

function actualOf(totals: MetricTotals, metricKey: (typeof PLAN_METRICS)[number]): number {
  if (metricKey === "leads_created") return totals.leadsCreated;
  if (metricKey === "applications") return totals.applications;
  if (metricKey === "payments") return totals.payments;
  return Number(totals.revenueRub);
}

export async function getOverview(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: OverviewInput,
): Promise<DashboardOverviewData> {
  const cells = await selectCells(transaction, snapshot, input.filters, input.scope);
  const totals = sumTotals(cells);

  const byDate = new Map<string, typeof cells>();
  for (const cell of cells) {
    byDate.set(cell.reportDate, [...(byDate.get(cell.reportDate) ?? []), cell]);
  }
  const daily: DailyPoint[] = eachDate(input.filters).map((date) => {
    const dayTotals = sumTotals(byDate.get(date) ?? []);
    return {
      date,
      leadsCreated: dayTotals.leadsCreated,
      applications: dayTotals.applications,
      payments: dayTotals.payments,
      revenueRub: dayTotals.revenueRub,
    };
  });

  let previous: MetricTotals | null = null;
  let deltas: MetricDelta | null = null;
  if (input.filters.compare) {
    const range = previousPeriod(input.filters);
    const previousCells = await selectCells(
      transaction,
      snapshot,
      { ...input.filters, ...range },
      input.scope,
    );
    previous = sumTotals(previousCells);
    deltas = {
      leadsCreatedPct: deltaPct(totals.leadsCreated, previous.leadsCreated),
      applicationsPct: deltaPct(totals.applications, previous.applications),
      paymentsPct: deltaPct(totals.payments, previous.payments),
      revenuePct: deltaPct(Number(totals.revenueRub), Number(previous.revenueRub)),
    };
  }

  const managerKey = input.scope.kind === "manager" && input.scope.amoUserIds[0] !== undefined
    ? String(input.scope.amoUserIds[0])
    : "all";
  const planRows = await transaction<{ metric_key: string; target_value: string }[]>`
    select metric_key, target_value
    from public.sales_plans
    where month = date_trunc('month', ${input.filters.from}::date)
      and manager_key = ${managerKey}
      and valid_to is null
  `;
  const plans: PlanProgress[] = planRows
    .filter((row): row is { metric_key: (typeof PLAN_METRICS)[number]; target_value: string } =>
      (PLAN_METRICS as readonly string[]).includes(row.metric_key))
    .map((row) => {
      const target = Number(row.target_value);
      const actual = actualOf(totals, row.metric_key);
      return {
        metricKey: row.metric_key,
        targetValue: formatKopecks(BigInt(Math.round(target * 100))),
        completionPct: target === 0 ? null : Math.round((actual / target) * 1_000) / 10,
      };
    })
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey));

  const acceptedRows = await transaction<{ code: string }[]>`
    select distinct code from public.data_quality_issues where status = 'accepted'
  `;
  const gate = evaluateQualityGate(snapshot.qualitySummary, {
    acceptedCodes: acceptedRows.map((row) => row.code),
  });

  const [freshness] = await transaction<{ finished_at: Date | null }[]>`
    select max(finished_at) as finished_at from public.sync_runs where status = 'success'
  `;
  const stale = freshness?.finished_at === null || freshness?.finished_at === undefined
    ? true
    : input.now.getTime() - freshness.finished_at.getTime() > STALE_AFTER_MS;

  return {
    totals,
    previous,
    deltas,
    daily,
    plans,
    quality: {
      counters: snapshot.qualitySummary,
      approved: gate.approved,
      blockingCodes: gate.blockingCodes,
    },
    stale,
  };
}
