import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../../lib/http-security";
import { withRoute } from "../../../../../../lib/http/route";
import { getDatabase } from "../../../../../../lib/server/runtime";
import { sheetClientFactory, sheetSecrets } from "../../../../../../lib/sheets/runtime";
import { validateSheetTarget } from "../../../../../../lib/sheets/target-service";

type TargetRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute<unknown, TargetRouteContext>(async (request, context) => {
  requireSameOrigin(request);
  requireRole(await requireUser(), ["admin"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { id } = await context.routeContext.params;
  const targetId = z.uuid().parse(id);

  return validateSheetTarget(
    { db: getDatabase(), factory: sheetClientFactory(), secrets: sheetSecrets() },
    targetId,
  );
});
