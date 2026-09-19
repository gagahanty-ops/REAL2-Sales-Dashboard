import { collectSystemStatus, isDatabaseReachable } from "@real2/db";
import { evaluateSystemHealth } from "@real2/domain";

import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

/**
 * Public readiness probe. It answers one boolean: anything more would tell an
 * unauthenticated caller about the internals. Details live behind the
 * authenticated system status.
 */
export const GET = withRoute(async () => {
  const db = getDatabase();
  const databaseReachable = await isDatabaseReachable(db);
  if (!databaseReachable) {
    return Response.json({ ready: false }, { status: 503 });
  }

  const status = await collectSystemStatus(db);
  const health = evaluateSystemHealth({ ...status, now: new Date(), databaseReachable });
  return Response.json(
    { ready: health.readiness.ready },
    { status: health.readiness.ready ? 200 : 503 },
  );
});
