import {
  withCurrentSnapshot,
  type DashboardQueryFilters,
  type DashboardQueryScope,
  type SnapshotMeta,
} from "@real2/db";
import {
  deriveDashboardScope,
  parseDashboardFilters,
  toMoscowDate,
  type DashboardFilters,
  type DashboardMeta,
} from "@real2/domain";
import type { TransactionSql } from "postgres";

import { requireRole } from "../auth/authorization";
import { requireUser } from "../auth/require-user";
import { getDatabase } from "../server/runtime";

export type DashboardRequestContext = Readonly<{
  filters: DashboardFilters;
  scope: DashboardQueryScope;
  snapshot: SnapshotMeta;
  now: Date;
}>;

function metaOf(
  snapshot: SnapshotMeta,
  traceId: string,
  stale: boolean,
): DashboardMeta {
  return {
    traceId,
    snapshotVersion: snapshot.version,
    generatedAt: snapshot.generatedAt.toISOString(),
    sourceFreshAt: snapshot.sourceFreshAt.toISOString(),
    stale,
  };
}

/**
 * Shared dashboard request pipeline: the session decides the scope, the query
 * string only narrows it, and one read-only transaction pins one approved
 * snapshot for every block of the answer.
 */
export async function runDashboardQuery<T>(
  request: Request,
  traceId: string,
  query: (
    transaction: TransactionSql,
    context: DashboardRequestContext,
  ) => Promise<Readonly<{ data: T; stale?: boolean }>>,
): Promise<Readonly<{ meta: DashboardMeta }> & T> {
  const user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  const now = new Date();
  const today = toMoscowDate(now.toISOString()) ?? now.toISOString().slice(0, 10);
  const filters = parseDashboardFilters(new URL(request.url).searchParams, { today });
  const scope = deriveDashboardScope(
    { role: user.role, amoUserId: user.amoUserId },
    filters,
  );

  const result = await withCurrentSnapshot(getDatabase(), async (transaction, snapshot) =>
    query(transaction, {
      filters,
      scope,
      snapshot,
      now,
    }));

  return {
    meta: metaOf(result.snapshot, traceId, result.data.stale === true),
    ...result.data.data,
  };
}

export type { DashboardQueryFilters, DashboardQueryScope };
