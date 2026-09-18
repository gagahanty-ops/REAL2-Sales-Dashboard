import { createHash } from "node:crypto";

import {
  createMetricSnapshot,
  summarizeOpenQualityIssues,
  type Database,
  type MetricCellInput,
  type MetricLeadFactInput,
  type MetricSnapshot,
  type StageSnapshotRowInput,
} from "@real2/db";
import {
  AppError,
  aggregateMetrics,
  displayNameFor,
  type MetricLeadFact,
  type NormalizedChannel,
} from "@real2/domain";

export type BuildSnapshotDeps = Readonly<{
  db: Database;
}>;

const ALL = "all";
const UNASSIGNED = "unassigned";

type LeadRow = {
  account_id: string;
  amo_lead_id: string;
  name: string;
  current_status_id: string;
  current_responsible_user_id: string | null;
  manager_name: string | null;
  price_rub: string | null;
  created_date: Date;
  normalized_channel: string;
  amo_url: string;
  application_at: Date | null;
  won_at: Date | null;
  currently_won: boolean;
  quality_codes: string[];
  last_stage_at: Date | null;
};

type StatusRow = { status_id: string; name: string; is_won: boolean };

type SnapshotHeaderRow = {
  id: string;
  version: string;
  sync_run_id: string;
  config_id: string;
  status: MetricSnapshot["status"];
  generated_at: Date;
  source_fresh_at: Date;
  approved_at: Date | null;
  published_at: Date | null;
  checksum: string;
  quality_summary: Record<string, number>;
};

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError("E_DB", 500);
  return parsed;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function managerKeyOf(amoUserId: string | null): string {
  return amoUserId === null ? UNASSIGNED : amoUserId;
}

function money(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value : `${value}.00`;
}

function kopecks(value: string | null): bigint {
  if (value === null) return 0n;
  const [whole, fraction = "00"] = value.split(".");
  return BigInt(whole as string) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function formatKopecks(value: bigint): string {
  const rubles = value / 100n;
  return `${rubles}.${(value % 100n).toString().padStart(2, "0")}`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Canonical serialization: the checksum must not depend on row order. */
function checksumOf(
  cells: readonly MetricCellInput[],
  facts: readonly MetricLeadFactInput[],
  stageRows: readonly StageSnapshotRowInput[],
): string {
  const canonical = JSON.stringify({
    cells: [...cells]
      .map((cell) => [
        cell.reportDate, cell.managerKey, cell.channelKey, cell.leadsCreated,
        cell.applications, cell.payments, cell.revenue,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    facts: [...facts]
      .map((fact) => [
        fact.accountId, fact.amoLeadId, fact.reportDate, fact.managerKey,
        fact.channelKey, fact.currentStatusId, fact.priceRub,
        fact.applicationAt?.toISOString() ?? null, fact.wonAt?.toISOString() ?? null,
        fact.currentlyWon, [...fact.qualityCodes].sort(),
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    stageRows: [...stageRows]
      .map((row) => [
        row.statusId, row.managerKey, row.openCount, row.openAmount,
        row.medianAgeSeconds, row.averageAgeSeconds,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function cellsFor(
  facts: readonly MetricLeadFact[],
  dates: readonly string[],
): readonly MetricCellInput[] {
  const managerKeys = [...new Set(facts.map((fact) => fact.managerId))];
  const channels = [...new Set(facts.map((fact) => fact.channel))];
  const cells: MetricCellInput[] = [];

  const push = (
    reportDate: string,
    managerKey: string,
    channelKey: string,
    scoped: readonly MetricLeadFact[],
  ): void => {
    const metrics = aggregateMetrics({ facts: scoped, from: reportDate, to: reportDate });
    if (
      metrics.leadsCreated === 0
      && metrics.applications === 0
      && metrics.payments === 0
      && managerKey !== ALL
    ) {
      return;
    }
    cells.push({
      reportDate,
      managerKey,
      channelKey,
      leadsCreated: metrics.leadsCreated,
      applications: metrics.applications,
      payments: metrics.payments,
      revenue: metrics.revenueRub,
    });
  };

  for (const reportDate of dates) {
    push(reportDate, ALL, ALL, facts);
    for (const managerId of managerKeys) {
      push(
        reportDate,
        managerKeyOf(managerId === null ? null : String(managerId)),
        ALL,
        facts.filter((fact) => fact.managerId === managerId),
      );
    }
    for (const channel of channels) {
      push(reportDate, ALL, channel, facts.filter((fact) => fact.channel === channel));
    }
    for (const managerId of managerKeys) {
      for (const channel of channels) {
        push(
          reportDate,
          managerKeyOf(managerId === null ? null : String(managerId)),
          channel,
          facts.filter(
            (fact) => fact.managerId === managerId && fact.channel === channel,
          ),
        );
      }
    }
  }
  return cells;
}

/**
 * Builds one immutable candidate snapshot from the normalized layer of a
 * successful run. Rebuilding the same run with unchanged data returns the
 * existing snapshot; changed data is a conflict, because snapshot evidence is
 * never rewritten (SPEC M6.5).
 */
export async function buildMetricSnapshot(
  deps: BuildSnapshotDeps,
  syncRunId: string,
  configId: string,
): Promise<MetricSnapshot> {
  const db = deps.db;

  const [run] = await db<{
    status: string;
    finished_at: Date | null;
    started_at: Date;
    source_max_updated_at: Date | null;
    account_id: string;
  }[]>`
    select runs.status, runs.finished_at, runs.started_at, runs.source_max_updated_at,
      connections.account_id
    from public.sync_runs as runs
    join public.amo_connections as connections on connections.id = runs.connection_id
    where runs.id = ${syncRunId}
  `;
  if (!run) throw new AppError("E_NOT_FOUND", 404);
  if (run.status !== "success") throw new AppError("E_CONFLICT", 409);

  const [config] = await db<{ id: string; pipeline_id: string; won_status_id: string }[]>`
    select id, pipeline_id, won_status_id from public.pipeline_configs
    where id = ${configId}
  `;
  if (!config) throw new AppError("E_NOT_FOUND", 404);

  // Stage ages are measured against the instant the data was true, not the
  // moment the builder happened to run: a snapshot must be a pure function of
  // its input so an identical rebuild keeps the same checksum.
  const sourceFreshAt = run.source_max_updated_at ?? run.finished_at ?? run.started_at;
  const accountId = safeInteger(run.account_id);
  const leadRows = await db<LeadRow[]>`
    select
      leads.account_id,
      leads.amo_lead_id,
      leads.name,
      leads.current_status_id,
      leads.current_responsible_user_id,
      users.name as manager_name,
      leads.price_rub,
      leads.created_date,
      leads.normalized_channel,
      leads.amo_url,
      milestones.application_at,
      milestones.won_at,
      coalesce(milestones.currently_won, false) as currently_won,
      coalesce(
        array(
          select code from public.data_quality_issues as issues
          where issues.account_id = leads.account_id
            and issues.amo_lead_id = leads.amo_lead_id
            and issues.status = 'open'
          order by code
        ),
        '{}'
      ) as quality_codes,
      (
        select max(occurred_at) from public.lead_stage_events as events
        where events.account_id = leads.account_id
          and events.amo_lead_id = leads.amo_lead_id
      ) as last_stage_at
    from public.leads as leads
    left join public.lead_milestones as milestones
      on milestones.account_id = leads.account_id
      and milestones.amo_lead_id = leads.amo_lead_id
    left join public.amo_users as users
      on users.account_id = leads.account_id
      and users.amo_user_id = leads.current_responsible_user_id
    where leads.account_id = ${accountId}
      and leads.pipeline_id = ${safeInteger(config.pipeline_id)}
      and not leads.is_deleted
    order by leads.amo_lead_id
  `;

  const statusRows = await db<StatusRow[]>`
    select status_id, name, is_won from public.pipeline_statuses
    where account_id = ${accountId} and pipeline_id = ${safeInteger(config.pipeline_id)}
    order by sort_order, status_id
  `;
  const statusNames = new Map(
    statusRows.map((row) => [safeInteger(row.status_id), row.name] as const),
  );

  const metricFacts: MetricLeadFact[] = leadRows.map((row) => ({
    amoLeadId: safeInteger(row.amo_lead_id),
    createdDate: dateKey(row.created_date),
    applicationAt: row.application_at?.toISOString() ?? null,
    wonAt: row.won_at?.toISOString() ?? null,
    currentlyWon: row.currently_won,
    priceRub: money(row.price_rub),
    channel: row.normalized_channel as NormalizedChannel,
    managerId: row.current_responsible_user_id === null
      ? null
      : safeInteger(row.current_responsible_user_id),
  }));

  const storedFacts: MetricLeadFactInput[] = leadRows.map((row) => {
    const amoLeadId = safeInteger(row.amo_lead_id);
    return {
      accountId: safeInteger(row.account_id),
      amoLeadId,
      displayName: displayNameFor(row.name, amoLeadId),
      reportDate: dateKey(row.created_date),
      managerKey: managerKeyOf(row.current_responsible_user_id),
      managerName: row.manager_name ?? "Без ответственного",
      channelKey: row.normalized_channel,
      currentStatusId: safeInteger(row.current_status_id),
      priceRub: money(row.price_rub),
      applicationAt: row.application_at,
      wonAt: row.won_at,
      currentlyWon: row.currently_won,
      amoUrl: row.amo_url,
      qualityCodes: row.quality_codes,
    };
  });

  const dates = [...new Set(metricFacts.map((fact) => fact.createdDate))].sort();
  const cells = cellsFor(metricFacts, dates);

  const wonStatusId = safeInteger(config.won_status_id);
  const openRows = leadRows.filter(
    (row) => safeInteger(row.current_status_id) !== wonStatusId,
  );
  const stageGroups = new Map<string, LeadRow[]>();
  for (const row of openRows) {
    const key = `${row.current_status_id}:${managerKeyOf(row.current_responsible_user_id)}`;
    stageGroups.set(key, [...(stageGroups.get(key) ?? []), row]);
  }
  const stageRows: StageSnapshotRowInput[] = [...stageGroups.entries()]
    .map(([key, rows]) => {
      const [statusIdText, managerKey] = key.split(":");
      const statusId = safeInteger(statusIdText as string);
      const ages = rows
        .map((row) => row.last_stage_at)
        .filter((value): value is Date => value !== null)
        .map((value) =>
          Math.max(0, Math.round((sourceFreshAt.getTime() - value.getTime()) / 1_000)));
      return {
        statusId,
        statusName: statusNames.get(statusId) ?? `Статус ${statusId}`,
        managerKey: managerKey as string,
        openCount: rows.length,
        openAmount: formatKopecks(
          rows.reduce((sum, row) => sum + kopecks(money(row.price_rub)), 0n),
        ),
        medianAgeSeconds: median(ages),
        averageAgeSeconds: average(ages),
      };
    })
    .sort((left, right) =>
      left.statusId - right.statusId || left.managerKey.localeCompare(right.managerKey));

  const qualitySummary = await summarizeOpenQualityIssues(db);
  const checksum = checksumOf(cells, storedFacts, stageRows);

  const [existing] = await db<SnapshotHeaderRow[]>`
    select id, version, sync_run_id, config_id, status, generated_at,
      source_fresh_at, approved_at, published_at, checksum, quality_summary
    from public.metric_snapshots
    where sync_run_id = ${syncRunId} and config_id = ${configId}
  `;
  if (existing) {
    // Rebuilding unchanged input is idempotent; changed input would rewrite
    // evidence, which the snapshot contract forbids.
    if (existing.checksum !== checksum) throw new AppError("E_CONFLICT", 409);
    return {
      id: existing.id,
      version: safeInteger(existing.version),
      syncRunId: existing.sync_run_id,
      configId: existing.config_id,
      status: existing.status,
      generatedAt: existing.generated_at,
      sourceFreshAt: existing.source_fresh_at,
      approvedAt: existing.approved_at,
      publishedAt: existing.published_at,
      checksum: existing.checksum,
      qualitySummary: existing.quality_summary,
    };
  }

  return createMetricSnapshot(db, {
    syncRunId,
    configId,
    sourceFreshAt,
    checksum,
    qualitySummary,
    cells,
    facts: storedFacts,
    stageRows,
  });
}
