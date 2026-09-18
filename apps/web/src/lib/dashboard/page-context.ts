import {
  getManagerMetrics,
  withCurrentSnapshot,
  type DashboardQueryScope,
  type SnapshotMeta,
} from "@real2/db";
import {
  AppError,
  deriveDashboardScope,
  parseDashboardFilters,
  toMoscowDate,
  type DashboardFilters,
} from "@real2/domain";
import type { TransactionSql } from "postgres";

import type { SessionUser } from "../auth/authorization";
import { getDatabase } from "../server/runtime";

export type SearchParamsInput = Readonly<Record<string, string | string[] | undefined>>;

export function toSearchParams(input: SearchParamsInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

export type DashboardPageResult<T> =
  | Readonly<{
      status: "ready";
      filters: DashboardFilters;
      scope: DashboardQueryScope;
      snapshot: SnapshotMeta;
      data: T;
      managerOptions: readonly Readonly<{ value: string; label: string }>[];
    }>
  | Readonly<{
      status: "error";
      filters: DashboardFilters;
      errorCode: string;
    }>;

/**
 * One place where a dashboard page turns untrusted search parameters into a
 * scoped, snapshot-pinned read. A failure becomes an error state with a safe
 * code instead of an exception page.
 */
export async function loadDashboardPage<T>(
  user: SessionUser,
  searchParams: SearchParamsInput,
  query: (
    transaction: TransactionSql,
    snapshot: SnapshotMeta,
    context: Readonly<{ filters: DashboardFilters; scope: DashboardQueryScope }>,
  ) => Promise<T>,
): Promise<DashboardPageResult<T>> {
  const now = new Date();
  const today = toMoscowDate(now.toISOString()) ?? now.toISOString().slice(0, 10);
  let filters: DashboardFilters;
  try {
    filters = parseDashboardFilters(toSearchParams(searchParams), { today });
  } catch {
    return {
      status: "error",
      filters: parseDashboardFilters(new URLSearchParams(), { today }),
      errorCode: "E_VALIDATION",
    };
  }

  try {
    const scope = deriveDashboardScope(
      { role: user.role, amoUserId: user.amoUserId },
      filters,
    );
    const leadership = user.role === "admin" || user.role === "head";
    const result = await withCurrentSnapshot(getDatabase(), async (transaction, snapshot) => {
      const data = await query(transaction, snapshot, { filters, scope });
      const managers = leadership
        ? await getManagerMetrics(transaction, snapshot, { filters, scope })
        : null;
      return { data, managers };
    });
    return {
      status: "ready",
      filters,
      scope,
      snapshot: result.snapshot,
      data: result.data.data,
      managerOptions: (result.data.managers?.rows ?? [])
        .filter((row) => row.managerKey !== "unassigned")
        .map((row) => ({ value: row.managerKey, label: row.managerName })),
    };
  } catch (error) {
    return {
      status: "error",
      filters,
      errorCode: error instanceof AppError ? error.code : "E_INTERNAL",
    };
  }
}
