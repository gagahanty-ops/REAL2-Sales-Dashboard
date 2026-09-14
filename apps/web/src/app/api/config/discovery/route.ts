import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase, getServerEnv } from "../../../../lib/server/runtime";
import { discoverAmoConfigMetadata } from "../../../../lib/amo/config-discovery";

export const GET = withRoute(async (_request, context) => {
  requireRole(await requireUser(), ["admin"]);
  return discoverAmoConfigMetadata(
    getDatabase(),
    getServerEnv(),
    context.traceId,
  );
});
