import { listAlerts } from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { withRoute } from "../../../lib/http/route";
import { getDatabase } from "../../../lib/server/runtime";

const statusSchema = z.enum(["open", "acknowledged", "resolved"]);

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const raw = new URL(request.url).searchParams.get("status");
  const status = raw === null ? undefined : statusSchema.parse(raw);
  return listAlerts(getDatabase(), status === undefined ? {} : { status });
});
