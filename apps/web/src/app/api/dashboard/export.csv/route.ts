import { getDrilldown } from "@real2/db";
import { drilldownMetricSchema } from "@real2/domain";

import { toCsv } from "../../../../lib/dashboard/csv";
import { runDashboardQuery } from "../../../../lib/dashboard/handler";
import { withRoute } from "../../../../lib/http/route";

const EXPORT_LIMIT = 100;

export const GET = withRoute(async (request, context) => {
  const params = new URL(request.url).searchParams;
  const metric = drilldownMetricSchema.parse(params.get("metric") ?? "leads_created");
  const result = await runDashboardQuery(
    request,
    context.traceId,
    async (transaction, dashboard) => ({
      data: await getDrilldown(transaction, dashboard.snapshot, {
        filters: dashboard.filters,
        scope: dashboard.scope,
        metric,
        limit: EXPORT_LIMIT,
      }),
    }),
  );

  return new Response(toCsv(result.rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="real2-${metric}.csv"`,
      "x-trace-id": context.traceId,
      "x-snapshot-version": String(result.meta.snapshotVersion),
    },
  });
});
