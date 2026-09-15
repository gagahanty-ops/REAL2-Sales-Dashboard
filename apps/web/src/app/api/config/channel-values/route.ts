import {
  getActivePipelineConfig,
  getCurrentSafeAmoConnectionStatus,
  getRawChannelValues,
} from "@real2/db";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

export const GET = withRoute(async () => {
  requireRole(await requireUser(), ["admin", "head"]);
  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  const config = connection
    ? await getActivePipelineConfig(db, connection.id)
    : null;
  const values =
    connection && config?.sourceFieldId
      ? await getRawChannelValues(db, {
          connectionId: connection.id,
          sourceFieldId: config.sourceFieldId,
        })
      : [];

  return {
    configVersion: config?.version ?? null,
    values,
  };
});
