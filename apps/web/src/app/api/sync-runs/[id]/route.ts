import { getSyncRunDetail } from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

type SyncRunRouteContext = { params: Promise<{ id: string }> };

export const GET = withRoute<unknown, SyncRunRouteContext>(async (
  _request,
  context,
) => {
  requireRole(await requireUser(), ["admin", "head"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { id } = await context.routeContext.params;
  const runId = z.uuid().parse(id);
  const run = await getSyncRunDetail(getDatabase(), runId);
  if (!run) throw new AppError("E_NOT_FOUND", 404);
  return run;
});
