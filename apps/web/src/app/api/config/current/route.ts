import {
  getActivePipelineConfig,
  getCurrentSafeAmoConnectionStatus,
} from "@real2/db";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";
import { toPublicPipelineConfig } from "../../../../lib/amo/config-public";

export const GET = withRoute(async () => {
  requireRole(await requireUser(), ["admin", "head"]);
  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection) return null;
  const config = await getActivePipelineConfig(db, connection.id);
  return config ? toPublicPipelineConfig(config) : null;
});
