import { getLeadDetail } from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

type LeadRouteContext = { params: Promise<{ amoLeadId: string }> };

const leadIdSchema = z.coerce.number().int().positive();

export const GET = withRoute<unknown, LeadRouteContext>(async (_request, context) => {
  const user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { amoLeadId } = await context.routeContext.params;
  const leadId = leadIdSchema.parse(amoLeadId);

  const detail = await getLeadDetail(getDatabase(), leadId, {
    role: user.role,
    amoUserId: user.amoUserId,
  });
  if (!detail) throw new AppError("E_NOT_FOUND", 404);
  return detail;
});
