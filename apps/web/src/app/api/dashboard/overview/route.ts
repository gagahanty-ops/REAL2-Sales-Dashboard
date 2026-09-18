import { getOverview } from "@real2/db";

import { runDashboardQuery } from "../../../../lib/dashboard/handler";
import { withRoute } from "../../../../lib/http/route";

export const GET = withRoute(async (request, context) =>
  runDashboardQuery(request, context.traceId, async (transaction, dashboard) => {
    const overview = await getOverview(transaction, dashboard.snapshot, {
      filters: dashboard.filters,
      scope: dashboard.scope,
      now: dashboard.now,
    });
    const { stale, ...rest } = overview;
    return {
      stale,
      data: {
        filters: {
          from: dashboard.filters.from,
          to: dashboard.filters.to,
          channels: dashboard.filters.channels,
          managerIds: dashboard.filters.managerIds,
          includeUnassigned: dashboard.filters.includeUnassigned,
          compare: dashboard.filters.compare,
        },
        ...rest,
      },
    };
  }));
