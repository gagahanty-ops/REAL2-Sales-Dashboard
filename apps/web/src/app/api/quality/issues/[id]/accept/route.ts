import { acceptQualityIssue } from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../../lib/http-security";
import { readJson, withRoute } from "../../../../../../lib/http/route";
import { getDatabase } from "../../../../../../lib/server/runtime";

type AcceptRouteContext = { params: Promise<{ id: string }> };

const acceptSchema = z.strictObject({
  reason: z.string().trim().min(10).max(500),
});

export const POST = withRoute<unknown, AcceptRouteContext>(async (
  request,
  context,
) => {
  requireSameOrigin(request);
  const user = requireRole(await requireUser(), ["admin"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { id } = await context.routeContext.params;
  const issueId = z.uuid().parse(id);
  const input = acceptSchema.parse(await readJson(request));
  return acceptQualityIssue(getDatabase(), {
    issueId,
    actorId: user.id,
    reason: input.reason,
  });
});
