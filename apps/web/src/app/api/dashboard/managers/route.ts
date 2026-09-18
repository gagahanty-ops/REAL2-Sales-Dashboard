import { getManagerMetrics } from "@real2/db";

import { runDashboardQuery } from "../../../../lib/dashboard/handler";
import { withRoute } from "../../../../lib/http/route";

export const GET = withRoute(async (request, context) =>
  runDashboardQuery(request, context.traceId, async (transaction, dashboard) => ({
    data: await getManagerMetrics(transaction, dashboard.snapshot, {
      filters: dashboard.filters,
      scope: dashboard.scope,
    }),
  })));
