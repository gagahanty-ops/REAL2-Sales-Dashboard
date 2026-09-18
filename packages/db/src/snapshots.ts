import { AppError, evaluateQualityGate } from "@real2/domain";
import type { JSONValue, TransactionSql } from "postgres";

import type { Database } from "./client.js";

export type SnapshotStatus = "candidate" | "approved" | "published" | "rejected";

export type MetricCellInput = Readonly<{
  reportDate: string;
  managerKey: string;
  channelKey: string;
  leadsCreated: number;
  applications: number;
  payments: number;
  revenue: string;
}>;

export type MetricLeadFactInput = Readonly<{
  accountId: number;
  amoLeadId: number;
  displayName: string;
  reportDate: string;
  managerKey: string;
  managerName: string;
  channelKey: string;
  currentStatusId: number;
  priceRub: string | null;
  applicationAt: Date | null;
  wonAt: Date | null;
  currentlyWon: boolean;
  amoUrl: string;
  qualityCodes: readonly string[];
}>;

export type StageSnapshotRowInput = Readonly<{
  statusId: number;
  statusName: string;
  managerKey: string;
  openCount: number;
  openAmount: string;
  medianAgeSeconds: number | null;
  averageAgeSeconds: number | null;
}>;

export type CreateSnapshotInput = Readonly<{
  syncRunId: string;
  configId: string;
  sourceFreshAt: Date;
  checksum: string;
  qualitySummary: Readonly<Record<string, number>>;
  cells: readonly MetricCellInput[];
  facts: readonly MetricLeadFactInput[];
  stageRows: readonly StageSnapshotRowInput[];
}>;

export type MetricSnapshot = Readonly<{
  id: string;
  version: number;
  syncRunId: string;
  configId: string;
  status: SnapshotStatus;
  generatedAt: Date;
  sourceFreshAt: Date;
  approvedAt: Date | null;
  publishedAt: Date | null;
  checksum: string;
  qualitySummary: Readonly<Record<string, number>>;
}>;

export type SnapshotValidation = Readonly<{
  approved: boolean;
  /** Stable, safe reason codes; never source text. */
  failures: readonly string[];
  blockingCodes: readonly string[];
}>;

type SnapshotRow = {
  id: string;
  version: string;
  sync_run_id: string;
  config_id: string;
  status: SnapshotStatus;
  generated_at: Date;
  source_fresh_at: Date;
  approved_at: Date | null;
  published_at: Date | null;
  checksum: string;
  quality_summary: Record<string, number>;
};

const SHA256 = /^[a-f0-9]{64}$/;
const MONEY = /^(0|[1-9]\d{0,11})\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError("E_DB", 500);
  return parsed;
}

function mapSnapshot(row: SnapshotRow): MetricSnapshot {
  return {
    id: row.id,
    version: safeInteger(row.version),
    syncRunId: row.sync_run_id,
    configId: row.config_id,
    status: row.status,
    generatedAt: row.generated_at,
    sourceFreshAt: row.source_fresh_at,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    checksum: row.checksum,
    qualitySummary: row.quality_summary,
  };
}

const SNAPSHOT_COLUMNS = `id, version, sync_run_id, config_id, status, generated_at,
  source_fresh_at, approved_at, published_at, checksum, quality_summary`;

function validateCreateInput(input: CreateSnapshotInput): void {
  if (!SHA256.test(input.checksum)) throw new AppError("E_VALIDATION", 422);
  for (const cell of input.cells) {
    if (
      !DATE.test(cell.reportDate)
      || !MONEY.test(cell.revenue)
      || !Number.isSafeInteger(cell.leadsCreated)
      || !Number.isSafeInteger(cell.applications)
      || !Number.isSafeInteger(cell.payments)
      || cell.leadsCreated < 0
      || cell.applications < 0
      || cell.payments < 0
    ) {
      throw new AppError("E_VALIDATION", 422);
    }
  }
  for (const fact of input.facts) {
    if (
      !DATE.test(fact.reportDate)
      || (fact.priceRub !== null && !MONEY.test(fact.priceRub))
      || !Number.isSafeInteger(fact.amoLeadId)
      || fact.amoLeadId <= 0
    ) {
      throw new AppError("E_VALIDATION", 422);
    }
  }
}

/** Writes one candidate snapshot with all its evidence in a single transaction. */
export async function createMetricSnapshot(
  db: Database,
  input: CreateSnapshotInput,
): Promise<MetricSnapshot> {
  validateCreateInput(input);
  return db.begin(async (transaction) => {
    const [row] = await transaction<SnapshotRow[]>`
      insert into public.metric_snapshots (
        sync_run_id, config_id, source_fresh_at, checksum, quality_summary
      ) values (
        ${input.syncRunId}, ${input.configId}, ${input.sourceFreshAt},
        ${input.checksum}, ${transaction.json(input.qualitySummary as JSONValue)}
      )
      returning id, version, sync_run_id, config_id, status, generated_at,
        source_fresh_at, approved_at, published_at, checksum, quality_summary
    `;
    if (!row) throw new AppError("E_DB", 500);

    for (const cell of input.cells) {
      await transaction`
        insert into public.metric_cells (
          snapshot_id, report_date, manager_key, channel_key, leads_created,
          applications, payments, revenue
        ) values (
          ${row.id}, ${cell.reportDate}, ${cell.managerKey}, ${cell.channelKey},
          ${cell.leadsCreated}, ${cell.applications}, ${cell.payments}, ${cell.revenue}
        )
      `;
    }
    for (const fact of input.facts) {
      await transaction`
        insert into public.metric_lead_facts (
          snapshot_id, account_id, amo_lead_id, display_name, report_date,
          manager_key, manager_name, channel_key, current_status_id, price_rub,
          application_at, won_at, currently_won, amo_url, quality_codes
        ) values (
          ${row.id}, ${fact.accountId}, ${fact.amoLeadId}, ${fact.displayName},
          ${fact.reportDate}, ${fact.managerKey}, ${fact.managerName},
          ${fact.channelKey}, ${fact.currentStatusId}, ${fact.priceRub},
          ${fact.applicationAt}, ${fact.wonAt}, ${fact.currentlyWon},
          ${fact.amoUrl}, ${transaction.array([...fact.qualityCodes])}
        )
      `;
    }
    for (const stage of input.stageRows) {
      await transaction`
        insert into public.stage_snapshot_rows (
          snapshot_id, status_id, status_name, manager_key, open_count,
          open_amount, median_age_seconds, average_age_seconds
        ) values (
          ${row.id}, ${stage.statusId}, ${stage.statusName}, ${stage.managerKey},
          ${stage.openCount}, ${stage.openAmount}, ${stage.medianAgeSeconds},
          ${stage.averageAgeSeconds}
        )
      `;
    }
    return mapSnapshot(row);
  });
}

type CellRow = {
  report_date: Date;
  manager_key: string;
  channel_key: string;
  leads_created: number;
  applications: number;
  payments: number;
  revenue: string;
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function kopecks(value: string): bigint {
  const match = MONEY.exec(value);
  if (!match) throw new AppError("E_DB", 500);
  const [whole, fraction] = value.split(".");
  return BigInt(whole as string) * 100n + BigInt(fraction as string);
}

/**
 * The single validation routine used by both `validateSnapshot` and approval:
 * a successful source run, an active configuration, no unaccepted blocking
 * issue, ordered funnel counts, and cross-footed totals for every date.
 */
async function validateCandidate(
  db: Database | TransactionSql,
  snapshotId: string,
): Promise<SnapshotValidation> {
  const failures: string[] = [];
  const [snapshot] = await db<SnapshotRow[]>`
    select ${db.unsafe(SNAPSHOT_COLUMNS)} from public.metric_snapshots
    where id = ${snapshotId}
  `;
  if (!snapshot) throw new AppError("E_NOT_FOUND", 404);

  const [run] = await db<{ status: string }[]>`
    select status from public.sync_runs where id = ${snapshot.sync_run_id}
  `;
  if (run?.status !== "success") failures.push("source_run_not_successful");

  const [config] = await db<{ is_active: boolean }[]>`
    select is_active from public.pipeline_configs where id = ${snapshot.config_id}
  `;
  if (config?.is_active !== true) failures.push("configuration_not_active");

  const acceptedRows = await db<{ code: string }[]>`
    select distinct code from public.data_quality_issues where status = 'accepted'
  `;
  const gate = evaluateQualityGate(snapshot.quality_summary, {
    acceptedCodes: acceptedRows.map((row) => row.code),
  });
  if (!gate.approved) failures.push("quality_gate_blocked");

  const cells = await db<CellRow[]>`
    select report_date, manager_key, channel_key, leads_created, applications,
      payments, revenue
    from public.metric_cells
    where snapshot_id = ${snapshotId}
  `;
  if (cells.length === 0) failures.push("snapshot_has_no_cells");

  const totals = new Map<string, CellRow>();
  const managerSums = new Map<string, { leads: number; applications: number; payments: number; revenue: bigint }>();
  const channelSums = new Map<string, { leads: number; applications: number; payments: number; revenue: bigint }>();
  for (const cell of cells) {
    if (cell.payments > cell.applications || cell.applications > cell.leads_created) {
      failures.push("funnel_counts_out_of_order");
    }
    const date = dateKey(cell.report_date);
    if (cell.manager_key === "all" && cell.channel_key === "all") {
      totals.set(date, cell);
      continue;
    }
    const target = cell.channel_key === "all"
      ? managerSums
      : cell.manager_key === "all"
        ? channelSums
        : null;
    if (!target) continue;
    const sum = target.get(date) ?? { leads: 0, applications: 0, payments: 0, revenue: 0n };
    target.set(date, {
      leads: sum.leads + cell.leads_created,
      applications: sum.applications + cell.applications,
      payments: sum.payments + cell.payments,
      revenue: sum.revenue + kopecks(cell.revenue),
    });
  }

  for (const [date, total] of totals) {
    for (const sums of [managerSums.get(date), channelSums.get(date)]) {
      if (!sums) {
        failures.push("cross_foot_missing_breakdown");
        continue;
      }
      if (
        sums.leads !== total.leads_created
        || sums.applications !== total.applications
        || sums.payments !== total.payments
        || sums.revenue !== kopecks(total.revenue)
      ) {
        failures.push("cross_foot_mismatch");
      }
    }
  }

  const [factTotals] = await db<{ payments: number; revenue: string }[]>`
    select
      count(*) filter (where currently_won and won_at is not null)::integer as payments,
      coalesce(
        sum(price_rub) filter (where currently_won and won_at is not null), 0
      )::text as revenue
    from public.metric_lead_facts
    where snapshot_id = ${snapshotId}
  `;
  const totalPayments = [...totals.values()].reduce((sum, cell) => sum + cell.payments, 0);
  const totalRevenue = [...totals.values()].reduce(
    (sum, cell) => sum + kopecks(cell.revenue),
    0n,
  );
  if (factTotals) {
    const factRevenue = kopecks(
      factTotals.revenue.includes(".") ? factTotals.revenue : `${factTotals.revenue}.00`,
    );
    if (factTotals.payments !== totalPayments || factRevenue !== totalRevenue) {
      failures.push("facts_do_not_match_cells");
    }
  }

  return {
    approved: failures.length === 0,
    failures: [...new Set(failures)].sort(),
    blockingCodes: gate.blockingCodes,
  };
}

/** Read-only validation of any snapshot. */
export async function validateSnapshot(
  db: Database,
  snapshotId: string,
): Promise<SnapshotValidation> {
  return db.begin(async (transaction) => {
    await transaction`set transaction read only`;
    return validateCandidate(transaction, snapshotId);
  });
}

/**
 * Approves a candidate and moves the current pointer in one transaction. A
 * blocked candidate leaves the previous current snapshot untouched.
 */
export async function approveSnapshot(
  db: Database,
  snapshotId: string,
  approvedAt = new Date(),
): Promise<MetricSnapshot> {
  return db.begin(async (transaction) => {
    const [candidate] = await transaction<SnapshotRow[]>`
      select ${transaction.unsafe(SNAPSHOT_COLUMNS)} from public.metric_snapshots
      where id = ${snapshotId}
      for update
    `;
    if (!candidate) throw new AppError("E_NOT_FOUND", 404);
    if (candidate.status !== "candidate") throw new AppError("E_CONFLICT", 409);

    const validation = await validateCandidate(transaction, snapshotId);
    if (!validation.approved) throw new AppError("E_DATA_QUALITY_BLOCK", 409);

    const [approved] = await transaction<SnapshotRow[]>`
      update public.metric_snapshots
      set status = 'approved', approved_at = ${approvedAt}
      where id = ${snapshotId} and status = 'candidate'
      returning ${transaction.unsafe(SNAPSHOT_COLUMNS)}
    `;
    if (!approved) throw new AppError("E_CONFLICT", 409);

    await transaction`
      insert into public.current_snapshot (singleton, snapshot_id, updated_at)
      values (true, ${snapshotId}, ${approvedAt})
      on conflict (singleton) do update set
        snapshot_id = excluded.snapshot_id,
        updated_at = excluded.updated_at
    `;
    return mapSnapshot(approved);
  });
}

export async function rejectSnapshot(
  db: Database,
  snapshotId: string,
  rejectionCode: string,
): Promise<MetricSnapshot> {
  if (rejectionCode.length < 1 || rejectionCode.length > 80) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<SnapshotRow[]>`
    update public.metric_snapshots
    set status = 'rejected', rejection_code = ${rejectionCode}
    where id = ${snapshotId} and status = 'candidate'
    returning ${db.unsafe(SNAPSHOT_COLUMNS)}
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapSnapshot(row);
}

export async function getCurrentSnapshot(db: Database): Promise<MetricSnapshot | null> {
  const [row] = await db<SnapshotRow[]>`
    select ${db.unsafe(SNAPSHOT_COLUMNS.split(",").map((name) => `snapshots.${name.trim()}`).join(", "))}
    from public.current_snapshot as pointer
    join public.metric_snapshots as snapshots on snapshots.id = pointer.snapshot_id
    where pointer.singleton
  `;
  return row ? mapSnapshot(row) : null;
}

export async function getSnapshotByVersion(
  db: Database,
  version: number,
): Promise<MetricSnapshot | null> {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<SnapshotRow[]>`
    select ${db.unsafe(SNAPSHOT_COLUMNS)} from public.metric_snapshots
    where version = ${version}
  `;
  return row ? mapSnapshot(row) : null;
}

export type SnapshotCell = Readonly<{
  reportDate: string;
  managerKey: string;
  channelKey: string;
  leadsCreated: number;
  applications: number;
  payments: number;
  revenue: string;
}>;

export async function listSnapshotCells(
  db: Database,
  snapshotId: string,
  filter: Readonly<{ managerKey?: string; channelKey?: string }> = {},
): Promise<readonly SnapshotCell[]> {
  const rows = await db<CellRow[]>`
    select report_date, manager_key, channel_key, leads_created, applications,
      payments, revenue
    from public.metric_cells
    where snapshot_id = ${snapshotId}
      and manager_key = ${filter.managerKey ?? "all"}
      and channel_key = ${filter.channelKey ?? "all"}
    order by report_date
  `;
  return rows.map((row) => ({
    reportDate: dateKey(row.report_date),
    managerKey: row.manager_key,
    channelKey: row.channel_key,
    leadsCreated: row.leads_created,
    applications: row.applications,
    payments: row.payments,
    revenue: row.revenue,
  }));
}
