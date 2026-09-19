import { activateSheetTarget } from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../../lib/http-security";
import { withRoute } from "../../../../../../lib/http/route";
import { getDatabase } from "../../../../../../lib/server/runtime";

type TargetRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute<unknown, TargetRouteContext>(async (request, context) => {
  requireSameOrigin(request);
  const user = requireRole(await requireUser(), ["admin"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { id } = await context.routeContext.params;
  const targetId = z.uuid().parse(id);

  // Activation is an explicit decision: it never turns publication on by
  // itself, it only says which copy would be written if it were enabled.
  return activateSheetTarget(getDatabase(), targetId, user.id);
});
