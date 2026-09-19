import { AppError } from "@real2/domain";
import type { JSONValue } from "postgres";

import type { Database } from "./client.js";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export type SystemAlert = Readonly<{
  id: string;
  traceId: string;
  source: string;
  code: string;
  severity: AlertSeverity;
  status: AlertStatus;
  safeSummary: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
}>;

export type RaiseAlertInput = Readonly<{
  traceId: string;
  source: string;
  code: string;
  severity: AlertSeverity;
  /** Safe text only: no payloads, no personal data, no secrets. */
  safeSummary: string;
  safeContext?: JSONValue;
  seenAt?: Date;
}>;

type AlertRow = {
  id: string;
  trace_id: string;
  source: string;
  code: string;
  severity: AlertSeverity;
  status: AlertStatus;
  safe_summary: string;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  acknowledged_by: string | null;
  resolved_at: Date | null;
};

const ALERT_COLUMNS = `id, trace_id, source, code, severity, status, safe_summary,
  occurrence_count, first_seen_at, last_seen_at, acknowledged_by, resolved_at`;

function mapAlert(row: AlertRow): SystemAlert {
  return {
    id: row.id,
    traceId: row.trace_id,
    source: row.source,
    code: row.code,
    severity: row.severity,
    status: row.status,
    safeSummary: row.safe_summary,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Raises one alert per source and code. A repeat does not create a second row:
 * it counts the occurrence, so an operator sees "thirty times since 09:00"
 * instead of thirty identical alerts.
 */
export async function raiseAlert(
  db: Database,
  input: RaiseAlertInput,
): Promise<SystemAlert> {
  if (
    input.safeSummary.trim() === ""
    || input.safeSummary.length > 500
    || input.source.trim() === ""
    || input.code.trim() === ""
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
  const seenAt = input.seenAt ?? new Date();
  const [row] = await db<AlertRow[]>`
    insert into public.system_alerts (
      trace_id, source, code, severity, safe_summary, safe_context,
      first_seen_at, last_seen_at
    ) values (
      ${input.traceId}, ${input.source}, ${input.code}, ${input.severity},
      ${input.safeSummary}, ${db.json(input.safeContext ?? {})}, ${seenAt}, ${seenAt}
    )
    on conflict (source, code) where status = 'open'
    do update set
      occurrence_count = public.system_alerts.occurrence_count + 1,
      last_seen_at = excluded.last_seen_at,
      safe_context = excluded.safe_context
    returning ${db.unsafe(ALERT_COLUMNS)}
  `;
  if (!row) throw new AppError("E_DB", 500);
  return mapAlert(row);
}

export async function acknowledgeAlert(
  db: Database,
  alertId: string,
  actorId: string,
  acknowledgedAt = new Date(),
): Promise<SystemAlert> {
  const [row] = await db<AlertRow[]>`
    update public.system_alerts
    set status = 'acknowledged', acknowledged_by = ${actorId},
      acknowledged_at = ${acknowledgedAt}
    where id = ${alertId} and status = 'open'
    returning ${db.unsafe(ALERT_COLUMNS)}
  `;
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapAlert(row);
}

/** Resolves the open alert of a source and code once the cause is gone. */
export async function resolveAlert(
  db: Database,
  source: string,
  code: string,
  resolvedAt = new Date(),
): Promise<SystemAlert | null> {
  const [row] = await db<AlertRow[]>`
    update public.system_alerts
    set status = 'resolved', resolved_at = ${resolvedAt}
    where source = ${source} and code = ${code} and status in ('open', 'acknowledged')
    returning ${db.unsafe(ALERT_COLUMNS)}
  `;
  return row ? mapAlert(row) : null;
}

export async function listAlerts(
  db: Database,
  filter: Readonly<{ status?: AlertStatus | undefined; limit?: number | undefined }> = {},
): Promise<readonly SystemAlert[]> {
  const limit = filter.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError("E_VALIDATION", 422);
  }
  const rows = await db<AlertRow[]>`
    select ${db.unsafe(ALERT_COLUMNS)}
    from public.system_alerts
    where (${filter.status ?? null}::public.alert_status is null
      or status = ${filter.status ?? null}::public.alert_status)
    order by last_seen_at desc
    limit ${limit}
  `;
  return rows.map(mapAlert);
}

export async function countOpenAlerts(
  db: Database,
  severity?: AlertSeverity,
): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    select count(*)::integer as count from public.system_alerts
    where status = 'open'
      and (${severity ?? null}::public.alert_severity is null
        or severity = ${severity ?? null}::public.alert_severity)
  `;
  return row?.count ?? 0;
}
