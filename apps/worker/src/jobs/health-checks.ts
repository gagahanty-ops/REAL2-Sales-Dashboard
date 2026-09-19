import {
  collectSystemStatus,
  isDatabaseReachable,
  raiseAlert,
  resolveAlert,
  type Database,
} from "@real2/db";
import { evaluateSystemHealth, type SystemHealth } from "@real2/domain";

import { sendAlertEmail, type AlertEmailInput, type EmailTransport } from "../alerts/email.js";

export type HealthCheckDeps = Readonly<{
  db: Database;
  now?: () => Date;
  traceId: string;
  environment: string;
  runbookUrl: string;
  transport?: EmailTransport | null;
}>;

export type HealthCheckResult = Readonly<{
  health: SystemHealth;
  raised: readonly string[];
  resolved: readonly string[];
  emailed: number;
}>;

const OPERATIONS_SOURCE = "operations";

/**
 * Compares the current state with the open alerts: a condition that still
 * holds updates one alert, a condition that disappeared resolves it. The
 * dashboard is never emptied by this job; it only describes what is true.
 */
export async function runHealthChecks(deps: HealthCheckDeps): Promise<HealthCheckResult> {
  const now = deps.now?.() ?? new Date();
  const databaseReachable = await isDatabaseReachable(deps.db);
  const status = await collectSystemStatus(deps.db);
  const health = evaluateSystemHealth({ ...status, now, databaseReachable });

  const raised: string[] = [];
  let emailed = 0;
  for (const alert of health.alerts) {
    const stored = await raiseAlert(deps.db, {
      traceId: deps.traceId,
      source: OPERATIONS_SOURCE,
      code: alert.code,
      severity: alert.severity,
      safeSummary: alert.summary,
      seenAt: now,
    });
    raised.push(alert.code);
    if (alert.severity === "critical" && stored.occurrenceCount === 1) {
      const message: AlertEmailInput = {
        environment: deps.environment,
        code: alert.code,
        severity: alert.severity,
        firstSeenAt: stored.firstSeenAt,
        lastSeenAt: stored.lastSeenAt,
        occurrenceCount: stored.occurrenceCount,
        traceId: deps.traceId,
        runbookUrl: deps.runbookUrl,
      };
      if (await sendAlertEmail(deps.transport ?? null, message)) emailed += 1;
    }
  }

  const activeCodes = new Set(health.alerts.map((alert) => alert.code));
  const openRows = await deps.db<{ code: string }[]>`
    select code from public.system_alerts
    where source = ${OPERATIONS_SOURCE} and status in ('open', 'acknowledged')
  `;
  const resolved: string[] = [];
  for (const row of openRows) {
    if (activeCodes.has(row.code)) continue;
    await resolveAlert(deps.db, OPERATIONS_SOURCE, row.code, now);
    resolved.push(row.code);
  }

  return { health, raised, resolved, emailed };
}
