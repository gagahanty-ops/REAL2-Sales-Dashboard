import { listQualityIssues, summarizeOpenQualityIssues } from "@real2/db";
import { evaluateQualityGate, isQualityCode } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

const filterSchema = z.strictObject({
  code: z.string().refine(isQualityCode).optional(),
  severity: z.enum(["info", "warning", "blocking"]).optional(),
  status: z.enum(["open", "resolved", "accepted"]).optional(),
  cursor: z.string().min(1).max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const params = new URL(request.url).searchParams;
  const filter = filterSchema.parse(
    Object.fromEntries(
      ["code", "severity", "status", "cursor", "pageSize"]
        .map((key) => [key, params.get(key) ?? undefined])
        .filter(([, value]) => value !== undefined),
    ),
  );
  const db = getDatabase();
  const [page, summary] = await Promise.all([
    listQualityIssues(db, filter),
    summarizeOpenQualityIssues(db),
  ]);
  return { ...page, summary, gate: evaluateQualityGate(summary) };
});
