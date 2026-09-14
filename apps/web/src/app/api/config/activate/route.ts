import {
  channelRuleCandidateSchema,
  pipelineConfigCandidateSchema,
  validatePipelineConfig,
  AppError,
} from "@real2/domain";
import {
  activatePipelineConfig,
  getActivePipelineConfig,
  getCurrentSafeAmoConnectionStatus,
} from "@real2/db";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../lib/http-security";
import { readJson, withRoute } from "../../../../lib/http/route";
import { getDatabase, getServerEnv } from "../../../../lib/server/runtime";
import { discoverAmoConfigMetadata } from "../../../../lib/amo/config-discovery";
import { toPublicPipelineConfig } from "../../../../lib/amo/config-public";

const activationSchema = z.strictObject({
  candidate: pipelineConfigCandidateSchema,
  channelRules: z.array(channelRuleCandidateSchema).min(1),
  metadataChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  expectedActiveConfigId: z.string().uuid().nullable(),
  confirmNameChanges: z.boolean().optional().default(false),
});

export const POST = withRoute(async (request, context) => {
  requireSameOrigin(request);
  const admin = requireRole(await requireUser(), ["admin"]);
  const input = activationSchema.parse(await readJson(request));
  const db = getDatabase();
  const discovery = await discoverAmoConfigMetadata(db, getServerEnv(), context.traceId);
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection || connection.status !== "active") {
    throw new AppError("E_CONFIG_INCOMPLETE", 422);
  }
  const activeConfig = await getActivePipelineConfig(db, connection.id);
  const validation = validatePipelineConfig(input.candidate, discovery, {
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
  if (!validation.valid) throw new AppError("E_CONFIG_INCOMPLETE", 422);
  if (validation.metadataChecksum !== input.metadataChecksum) {
    throw new AppError("E_CONFLICT", 409);
  }
  if (validation.requiresNameConfirmation && !input.confirmNameChanges) {
    throw new AppError("E_CONFIG_INCOMPLETE", 422);
  }

  const config = await activatePipelineConfig(db, {
    amoConnectionId: connection.id,
    expectedActiveConfigId: input.expectedActiveConfigId,
    candidate: validation.resolved,
    channelRules: input.channelRules,
    metadataChecksum: validation.metadataChecksum,
    actorId: admin.id,
  });
  return { ...toPublicPipelineConfig(config), recalculationQueued: true };
});
