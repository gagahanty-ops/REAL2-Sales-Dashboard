import { collectSystemStatus, isDatabaseReachable, listAlerts } from "@real2/db";
import { evaluateSystemHealth } from "@real2/domain";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

export const GET = withRoute(async () => {
  requireRole(await requireUser(), ["admin", "head"]);
  const db = getDatabase();
  const databaseReachable = await isDatabaseReachable(db);
  const status = await collectSystemStatus(db);
  const health = evaluateSystemHealth({ ...status, now: new Date(), databaseReachable });
  const alerts = await listAlerts(db, { status: "open", limit: 50 });

  return {
    readiness: health.readiness,
    dashboard: health.dashboard,
    lastSuccessfulSyncAt: status.lastSuccessfulSyncAt,
    openBlockingQualityIssues: status.openBlockingQualityIssues,
    lastPublication: status.lastPublication,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      code: alert.code,
      severity: alert.severity,
      status: alert.status,
      safeSummary: alert.safeSummary,
      occurrenceCount: alert.occurrenceCount,
      firstSeenAt: alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt,
    })),
  };
});
