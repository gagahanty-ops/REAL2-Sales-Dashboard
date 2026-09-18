import { AppError, type DrilldownMetric, type DrilldownRow } from "@real2/domain";
import type { TransactionSql } from "postgres";

import { scopedManagerKeys, type DashboardQueryFilters, type DashboardQueryScope } from "./cells.js";
import type { SnapshotMeta } from "./with-snapshot.js";

export type DrilldownPosition = Readonly<{ createdDate: string; amoLeadId: number }>;

export type DrilldownInput = Readonly<{
  filters: DashboardQueryFilters;
  scope: DashboardQueryScope;
  metric: DrilldownMetric;
  after?: DrilldownPosition | null;
  limit?: number;
}>;

export type DrilldownResult = Readonly<{
  rows: readonly DrilldownRow[];
  /** Position of the last row, or null when the page is the last one. */
  next: DrilldownPosition | null;
}>;

const MAX_LIMIT = 100;

type FactRow = {
  amo_lead_id: string;
  display_name: string;
  report_date: Date;
  manager_key: string;
  manager_name: string;
  channel_key: string;
  price_rub: string | null;
  application_at: Date | null;
  won_at: Date | null;
  currently_won: boolean;
  amo_url: string;
  quality_codes: string[];
};

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError("E_DB", 500);
  return parsed;
}

function money(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value : `${value}.00`;
}

function toRow(row: FactRow): DrilldownRow {
  return {
    amoLeadId: safeInteger(row.amo_lead_id),
    name: row.display_name,
    createdDate: row.report_date.toISOString().slice(0, 10),
    applicationAt: row.application_at?.toISOString() ?? null,
    wonAt: row.won_at?.toISOString() ?? null,
    manager: {
      id: row.manager_key === "unassigned" ? null : safeInteger(row.manager_key),
      name: row.manager_name,
    },
    channel: row.channel_key as DrilldownRow["channel"],
    price: money(row.price_rub),
    amoUrl: row.amo_url,
    quality: row.quality_codes,
  };
}

/**
 * One keyset page of the snapshot's immutable lead facts. Rows are ordered by
 * `(created_date desc, amo_lead_id desc)`, so a page boundary can never repeat
 * or skip a lead, and the page shows the snapshot's state, never live data.
 */
export async function getDrilldown(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  input: DrilldownInput,
): Promise<DrilldownResult> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError("E_VALIDATION", 422);
  }
  const managerKeys = scopedManagerKeys(input.filters, input.scope);
  const metric = input.metric;

  const rows = await transaction<FactRow[]>`
    select amo_lead_id, display_name, report_date, manager_key, manager_name,
      channel_key, price_rub, application_at, won_at, currently_won, amo_url,
      quality_codes
    from public.metric_lead_facts
    where snapshot_id = ${snapshot.id}
      and report_date >= ${input.filters.from}
      and report_date < (${input.filters.to}::date + interval '1 day')
      and (
        ${managerKeys.length === 0}::boolean is true
        or manager_key = any(${managerKeys as string[]})
      )
      and (
        ${input.filters.channels.length === 0}::boolean is true
        or channel_key = any(${input.filters.channels as string[]})
      )
      and (
        ${metric}::text <> 'applications' or application_at is not null
      )
      and (
        ${metric}::text not in ('payments', 'revenue')
        or (currently_won and won_at is not null)
      )
      and (
        ${metric}::text <> 'stage_open' or not currently_won
      )
      and (
        ${metric}::text <> 'quality_issue' or cardinality(quality_codes) > 0
      )
      and (
        ${input.after === null || input.after === undefined}::boolean is true
        or (report_date, amo_lead_id)
          < (${input.after?.createdDate ?? null}::date, ${input.after?.amoLeadId ?? null}::bigint)
      )
    order by report_date desc, amo_lead_id desc
    limit ${limit + 1}
  `;

  const page = rows.slice(0, limit).map(toRow);
  const last = page.at(-1);
  return {
    rows: page,
    next: rows.length > limit && last
      ? { createdDate: last.createdDate, amoLeadId: last.amoLeadId }
      : null,
  };
}
