import { createSheetTarget, listSheetTargets } from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../lib/http-security";
import { readJson, withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

const targetSchema = z.strictObject({
  spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
  expectedTitle: z.string().trim().min(1).max(200),
});

export const GET = withRoute(async () => {
  requireRole(await requireUser(), ["admin", "head"]);
  return listSheetTargets(getDatabase());
});

export const POST = withRoute(async (request) => {
  requireSameOrigin(request);
  requireRole(await requireUser(), ["admin"]);
  const input = targetSchema.parse(await readJson(request));
  return createSheetTarget(getDatabase(), input);
});
