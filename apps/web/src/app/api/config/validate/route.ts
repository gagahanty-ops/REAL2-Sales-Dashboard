import {
  pipelineConfigCandidateSchema,
  validatePipelineConfig,
} from "@real2/domain";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../lib/http-security";
import { readJson, withRoute } from "../../../../lib/http/route";
import { getDatabase, getServerEnv } from "../../../../lib/server/runtime";
import { discoverAmoConfigMetadata } from "../../../../lib/amo/config-discovery";

export const POST = withRoute(async (request, context) => {
  requireSameOrigin(request);
  requireRole(await requireUser(), ["admin"]);
  const candidate = pipelineConfigCandidateSchema.parse(await readJson(request));
  const discovery = await discoverAmoConfigMetadata(
    getDatabase(),
    getServerEnv(),
    context.traceId,
  );
  return validatePipelineConfig(candidate, discovery);
});
