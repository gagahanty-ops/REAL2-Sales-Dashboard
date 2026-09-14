import {
  getCurrentSafeAmoConnectionStatus,
  type Database,
} from "@real2/db";
import {
  amoConfigDiscoverySchema,
  AppError,
  type AmoConfigDiscovery,
  type ServerEnv,
} from "@real2/domain";
import {
  amoFetch,
  createAmoTokenProvider,
  decodeTokenEncryptionKey,
} from "@real2/integrations";
import { z } from "zod";

import {
  AMO_BASE_URL,
  amoAccountSchema,
  assertAmoAccountBinding,
} from "./account";
import { createAmoAdminAuditSink } from "./audit";

const pipelineSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const statusSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const customFieldSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const amoUserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const pipelinesResponseSchema = z.object({
  _embedded: z.object({ pipelines: z.array(pipelineSchema) }),
});

const statusesResponseSchema = z.object({
  _embedded: z.object({ statuses: z.array(statusSchema) }),
});

const customFieldsResponseSchema = z.object({
  _embedded: z.object({ custom_fields: z.array(customFieldSchema) }),
});

const usersResponseSchema = z.object({
  _embedded: z.object({ users: z.array(amoUserSchema) }),
});

export async function discoverAmoConfigMetadata(
  db: Database,
  env: ServerEnv,
  traceId: string,
): Promise<AmoConfigDiscovery> {
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection || connection.status !== "active" || connection.baseUrl !== AMO_BASE_URL) {
    throw new AppError("E_CONFIG_INCOMPLETE", 422);
  }

  const auditSink = createAmoAdminAuditSink();
  const tokenProvider = createAmoTokenProvider(connection.id, {
    db,
    encryptionKey: decodeTokenEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
    oauthConfig: {
      clientId: env.AMO_CLIENT_ID,
      clientSecret: env.AMO_CLIENT_SECRET,
      redirectUri: env.AMO_REDIRECT_URI,
    },
    transport: { auditSink, traceId },
    async validateRefreshedAccessToken(accessToken, lockedConnection) {
      const account = await amoFetch({
        method: "GET",
        url: `${AMO_BASE_URL}/api/v4/account`,
        schema: amoAccountSchema,
        traceId,
        tokenProvider: {
          async getAccessToken() {
            return accessToken;
          },
        },
        auditSink,
        redirect: "error",
      });
      assertAmoAccountBinding(account, lockedConnection.accountId);
    },
  });

  const pipelinesResponse = await amoFetch({
    method: "GET",
    url: `${AMO_BASE_URL}/api/v4/leads/pipelines`,
    schema: pipelinesResponseSchema,
    traceId,
    tokenProvider,
    auditSink,
    redirect: "error",
  });

  const [pipelineStatuses, customFieldsResponse, usersResponse] = await Promise.all([
    Promise.all(
      pipelinesResponse._embedded.pipelines.map(async (pipeline) => {
        const statusesResponse = await amoFetch({
          method: "GET",
          url: `${AMO_BASE_URL}/api/v4/leads/pipelines/${pipeline.id}/statuses`,
          schema: statusesResponseSchema,
          traceId,
          tokenProvider,
          auditSink,
          redirect: "error",
        });
        return { ...pipeline, statuses: statusesResponse._embedded.statuses };
      }),
    ),
    amoFetch({
      method: "GET",
      url: `${AMO_BASE_URL}/api/v4/leads/custom_fields`,
      schema: customFieldsResponseSchema,
      traceId,
      tokenProvider,
      auditSink,
      redirect: "error",
    }),
    amoFetch({
      method: "GET",
      url: `${AMO_BASE_URL}/api/v4/users`,
      schema: usersResponseSchema,
      traceId,
      tokenProvider,
      auditSink,
      redirect: "error",
    }),
  ]);

  return amoConfigDiscoverySchema.parse({
    pipelines: pipelineStatuses,
    leadCustomFields: customFieldsResponse._embedded.custom_fields,
    users: usersResponse._embedded.users,
  });
}
