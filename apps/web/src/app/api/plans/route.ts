import { listSalesPlans, setSalesPlanTarget } from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../lib/http-security";
import { readJson, withRoute } from "../../../lib/http/route";
import { getDatabase } from "../../../lib/server/runtime";

const planSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  managerKey: z.string().regex(/^(all|unassigned|[1-9]\d{0,14})$/),
  metricKey: z.enum(["leads_created", "applications", "payments", "revenue"]),
  targetValue: z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/),
});

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const month = new URL(request.url).searchParams.get("month");
  const parsedMonth = month === null
    ? undefined
    : z.string().regex(/^\d{4}-\d{2}-01$/).parse(month);
  return listSalesPlans(getDatabase(), { month: parsedMonth });
});

export const POST = withRoute(async (request) => {
  requireSameOrigin(request);
  const user = requireRole(await requireUser(), ["admin"]);
  const input = planSchema.parse(await readJson(request));
  return setSalesPlanTarget(getDatabase(), { ...input, actorId: user.id });
});
