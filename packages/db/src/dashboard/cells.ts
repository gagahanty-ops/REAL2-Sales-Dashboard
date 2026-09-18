import { AppError, conversion, type MetricTotals } from "@real2/domain";
import type { TransactionSql } from "postgres";

import type { SnapshotMeta } from "./with-snapshot.js";

export type DashboardQueryFilters = Readonly<{
  from: string;
  to: string;
  channels: readonly string[];
  managerIds: readonly number[];
  includeUnassigned: boolean;
  allManagers: boolean;
  compare: boolean;
}>;

export type DashboardQueryScope = Readonly<{
  kind: "department" | "manager";
  amoUserIds: readonly number[];
  includeUnassigned: boolean;
}>;

export type CellRow = Readonly<{
  reportDate: string;
  managerKey: string;
  channelKey: string;
  leadsCreated: number;
  applications: number;
  payments: number;
  revenue: bigint;
}>;

const MONEY = /^-?\d+(?:\.\d{1,2})?$/;

export function kopecks(value: string): bigint {
  if (!MONEY.test(value)) throw new AppError("E_DB", 500);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(whole as string) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}

export function formatKopecks(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * The manager keys a scope may read. An empty list means the whole department,
 * which is expressed by the snapshot's own `all` aggregate row.
 */
export function scopedManagerKeys(
  filters: DashboardQueryFilters,
  scope: DashboardQueryScope,
): readonly string[] {
  const keys = scope.amoUserIds.map((id) => String(id));
  return scope.includeUnassigned ? [...keys, "unassigned"] : keys;
}

type RawCellRow = {
  report_date: Date;
  manager_key: string;
  channel_key: string;
  leads_created: number;
  applications: number;
  payments: number;
  revenue: string;
};

/**
 * Reads the cells of one snapshot for a scope. Manager and channel selections
 * use the snapshot's own aggregate rows, so a slice is never recomputed from
 * partially overlapping rows.
 */
export async function selectCells(
  transaction: TransactionSql,
  snapshot: SnapshotMeta,
  filters: DashboardQueryFilters,
  scope: DashboardQueryScope,
  grouping: Readonly<{ byManager?: boolean; byChannel?: boolean }> = {},
): Promise<readonly CellRow[]> {
  const managerKeys = scopedManagerKeys(filters, scope);
  const wantsManagerRows = grouping.byManager === true || managerKeys.length > 0;
  const wantsChannelRows = grouping.byChannel === true || filters.channels.length > 0;

  const rows = await transaction<RawCellRow[]>`
    select report_date, manager_key, channel_key, leads_created, applications,
      payments, revenue
    from public.metric_cells
    where snapshot_id = ${snapshot.id}
      and report_date >= ${filters.from}
      and report_date < (${filters.to}::date + interval '1 day')
      and (
        ${wantsManagerRows}::boolean is false and manager_key = 'all'
        or ${wantsManagerRows}::boolean is true and manager_key <> 'all'
      )
      and (
        ${wantsChannelRows}::boolean is false and channel_key = 'all'
        or ${wantsChannelRows}::boolean is true and channel_key <> 'all'
      )
      and (
        ${managerKeys.length === 0}::boolean is true
        or manager_key = any(${managerKeys as string[]})
      )
      and (
        ${filters.channels.length === 0}::boolean is true
        or channel_key = any(${filters.channels as string[]})
      )
    order by report_date, manager_key, channel_key
  `;

  return rows.map((row) => ({
    reportDate: row.report_date.toISOString().slice(0, 10),
    managerKey: row.manager_key,
    channelKey: row.channel_key,
    leadsCreated: row.leads_created,
    applications: row.applications,
    payments: row.payments,
    revenue: kopecks(row.revenue),
  }));
}

export function sumTotals(cells: readonly CellRow[]): MetricTotals {
  const leadsCreated = cells.reduce((sum, cell) => sum + cell.leadsCreated, 0);
  const applications = cells.reduce((sum, cell) => sum + cell.applications, 0);
  const payments = cells.reduce((sum, cell) => sum + cell.payments, 0);
  const revenue = cells.reduce((sum, cell) => sum + cell.revenue, 0n);
  const averageOrderValueRub = payments === 0
    ? null
    : formatKopecks(
        revenue / BigInt(payments)
        + (revenue % BigInt(payments) * 2n >= BigInt(payments) ? 1n : 0n),
      );

  return {
    leadsCreated,
    applications,
    payments,
    revenueRub: formatKopecks(revenue),
    leadToApplicationPct: conversion(applications, leadsCreated),
    applicationToPaymentPct: conversion(payments, applications),
    leadToPaymentPct: conversion(payments, leadsCreated),
    averageOrderValueRub,
  };
}
