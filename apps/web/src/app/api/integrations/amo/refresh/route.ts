import {
  getCurrentSafeAmoConnectionStatus,
  withLockedAmoConnection,
} from "@real2/db";
import { AppError } from "@real2/domain";
import {
  amoFetch,
  decodeTokenEncryptionKey,
  refreshConnection,
} from "@real2/integrations";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { withRoute } from "../../../../../lib/http/route";
import { getDatabase, getServerEnv } from "../../../../../lib/server/runtime";
import {
  AMO_BASE_URL,
  amoAccountSchema,
  assertAmoAccountBinding,
} from "../../../../../lib/amo/account";
import { createAmoAdminAuditSink } from "../../../../../lib/amo/audit";

export const POST = withRoute(async (request, context) => {
  requireRole(await requireUser(), ["admin"]);
  requireSameOrigin(request);
  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection) {
    throw new AppError("E_NOT_FOUND", 404);
  }

  const env = getServerEnv();
  const auditSink = createAmoAdminAuditSink();
  const accessToken = await refreshConnection(connection.id, {
    db,
    encryptionKey: decodeTokenEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
    oauthConfig: {
      clientId: env.AMO_CLIENT_ID,
      clientSecret: env.AMO_CLIENT_SECRET,
      redirectUri: env.AMO_REDIRECT_URI,
    },
    transport: { auditSink, traceId: context.traceId },
  });
  const account = await amoFetch({
    method: "GET",
    url: `${AMO_BASE_URL}/api/v4/account`,
    schema: amoAccountSchema,
    traceId: context.traceId,
    tokenProvider: {
      async getAccessToken() {
        return accessToken;
      },
    },
    auditSink,
    redirect: "error",
  });
  assertAmoAccountBinding(account, connection.accountId);

  const checkedAt = new Date();
  await withLockedAmoConnection(db, connection.id, async (locked, actions) => {
    if (
      locked.status !== "active" ||
      locked.accountId !== account.id ||
      locked.subdomain !== account.subdomain ||
      locked.baseUrl !== AMO_BASE_URL
    ) {
      throw new AppError("E_CONFLICT", 409);
    }
    await actions.markCheckedAt(checkedAt);
  });

  return { refreshed: true };
});
