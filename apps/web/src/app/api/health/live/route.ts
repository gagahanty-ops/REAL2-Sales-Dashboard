import { success } from "@real2/domain";

import { withRoute } from "../../../../lib/http/route";

export const GET = withRoute(async (_request, context) =>
  Response.json(success({ live: true as const }, { trace_id: context.traceId }), {
    headers: { "cache-control": "no-store" },
  }),
);
