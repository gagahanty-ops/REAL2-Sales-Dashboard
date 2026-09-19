import { listSheetLayoutMappings } from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../lib/http-security";
import { readJson, withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";
import { sheetClientFactory, sheetSecrets } from "../../../../lib/sheets/runtime";
import { replaceMappings } from "../../../../lib/sheets/target-service";

const mappingSchema = z.strictObject({
  targetId: z.uuid(),
  mappings: z
    .array(
      z.strictObject({
        reportKind: z.enum(["channels_daily", "plan_fact"]),
        logicalField: z.string().trim().min(1).max(80),
        sheetName: z.string().trim().min(1).max(100),
        rangeA1: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/),
        valueType: z.enum(["integer", "money", "percent", "date", "text"]),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const targetId = z.uuid().parse(new URL(request.url).searchParams.get("targetId"));
  return listSheetLayoutMappings(getDatabase(), targetId);
});

export const PUT = withRoute(async (request) => {
  requireSameOrigin(request);
  requireRole(await requireUser(), ["admin"]);
  const input = mappingSchema.parse(await readJson(request));
  return replaceMappings(
    { db: getDatabase(), factory: sheetClientFactory(), secrets: sheetSecrets() },
    input.targetId,
    input.mappings,
  );
});
