import {
  getActivePipelineConfig,
  getCurrentSafeAmoConnectionStatus,
} from "@real2/db";
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
  const db = getDatabase();
  const discovery = await discoverAmoConfigMetadata(
    db,
    getServerEnv(),
    context.traceId,
  );
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  const activeConfig = connection
    ? await getActivePipelineConfig(db, connection.id)
    : null;
  return validatePipelineConfig(candidate, discovery, {
    activeConfig: activeConfig
      ? {
          pipelineId: activeConfig.pipelineId,
          pipelineName: activeConfig.pipelineName,
          applicationStatusId: activeConfig.applicationStatusId,
          applicationStatusName: activeConfig.applicationStatusName,
          wonStatusId: activeConfig.wonStatusId,
          wonStatusName: activeConfig.wonStatusName,
          channelFieldId: activeConfig.sourceFieldId,
          channelFieldName: null,
        }
      : null,
  });
});
