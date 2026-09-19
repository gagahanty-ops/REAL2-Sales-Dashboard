import { acknowledgeAlert } from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { withRoute } from "../../../../../lib/http/route";
import { getDatabase } from "../../../../../lib/server/runtime";

type AlertRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute<unknown, AlertRouteContext>(async (request, context) => {
  requireSameOrigin(request);
  const user = requireRole(await requireUser(), ["admin"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { id } = await context.routeContext.params;
  const alertId = z.uuid().parse(id);

  // Acknowledging records who saw it; the underlying condition stays until it
  // actually goes away.
  return acknowledgeAlert(getDatabase(), alertId, user.id);
});
