import {
  disableAmoConnection,
  getCurrentSafeAmoConnectionStatus,
} from "@real2/db";
import { AppError } from "@real2/domain";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { withRoute } from "../../../../../lib/http/route";
import { getDatabase } from "../../../../../lib/server/runtime";

export const POST = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin"]);
  requireSameOrigin(request);
  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection) throw new AppError("E_NOT_FOUND", 404);

  await disableAmoConnection(db, connection.id);
  return { disconnected: true };
});
