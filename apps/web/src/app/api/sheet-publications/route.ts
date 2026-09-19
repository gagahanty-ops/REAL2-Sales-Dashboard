import { listSheetPublications } from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { withRoute } from "../../../lib/http/route";
import { getDatabase } from "../../../lib/server/runtime";

const limitSchema = z.coerce.number().int().min(1).max(100);

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = raw === null ? 25 : limitSchema.parse(raw);
  return listSheetPublications(getDatabase(), limit);
});
