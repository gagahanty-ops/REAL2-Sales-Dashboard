import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { getCurrentPublicAmoConnectionStatus } from "../../../../../lib/amo/admin";
import { withRoute } from "../../../../../lib/http/route";
import { getDatabase } from "../../../../../lib/server/runtime";

export const GET = withRoute(async () => {
  requireRole(await requireUser(), ["admin"]);
  return getCurrentPublicAmoConnectionStatus(getDatabase());
});
