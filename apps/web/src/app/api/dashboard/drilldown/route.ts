import { getDrilldown } from "@real2/db";
import {
  decodeDrilldownCursor,
  drilldownMetricSchema,
  encodeDrilldownCursor,
  filterHashOf,
} from "@real2/domain";
import { z } from "zod";

import { dashboardCursorKey } from "../../../../lib/dashboard/cursor-key";
import { runDashboardQuery } from "../../../../lib/dashboard/handler";
import { withRoute } from "../../../../lib/http/route";

const limitSchema = z.coerce.number().int().min(1).max(100);

export const GET = withRoute(async (request, context) =>
  runDashboardQuery(request, context.traceId, async (transaction, dashboard) => {
    const params = new URL(request.url).searchParams;
    const metric = drilldownMetricSchema.parse(params.get("metric") ?? "leads_created");
    const limitParam = params.get("limit");
    const limit = limitParam === null ? 50 : limitSchema.parse(limitParam);
    const key = dashboardCursorKey();
    const filterHash = filterHashOf({
      filters: dashboard.filters,
      scope: dashboard.scope,
      metric,
    });

    const cursorParam = params.get("cursor");
    const after = cursorParam === null
      ? null
      : decodeDrilldownCursor(cursorParam, key, {
          snapshotVersion: dashboard.snapshot.version,
          filterHash,
        });

    const page = await getDrilldown(transaction, dashboard.snapshot, {
      filters: dashboard.filters,
      scope: dashboard.scope,
      metric,
      after: after === null ? null : { createdDate: after.createdDate, amoLeadId: after.amoLeadId },
      limit,
    });

    return {
      data: {
        metric,
        rows: page.rows,
        nextCursor: page.next === null
          ? null
          : encodeDrilldownCursor(
              {
                snapshotVersion: dashboard.snapshot.version,
                createdDate: page.next.createdDate,
                amoLeadId: page.next.amoLeadId,
                filterHash,
              },
              key,
            ),
      },
    };
  }));
