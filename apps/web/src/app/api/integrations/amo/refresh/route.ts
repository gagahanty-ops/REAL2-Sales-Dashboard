import { getCurrentSafeAmoConnectionStatus } from "@real2/db";
import { AppError } from "@real2/domain";
import {
  decodeTokenEncryptionKey,
  refreshConnection,
  type AmoAuditEntry,
  type AmoAuditSink,
} from "@real2/integrations";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { withRoute } from "../../../../../lib/http/route";
import { safeLogger } from "../../../../../lib/logging/logger";
import { getDatabase, getServerEnv } from "../../../../../lib/server/runtime";

function auditSink(): AmoAuditSink {
  return {
    record(entry: AmoAuditEntry) {
      const log = entry.result === "success" ? safeLogger.info : safeLogger.error;
      log({
        message: entry.result === "success" ? "request completed" : "request failed",
        operation: "http_request",
        method: entry.method,
        normalized_path: entry.normalizedPath,
        ...(entry.responseStatus !== undefined
          ? { status: entry.responseStatus }
          : {}),
        duration_ms: entry.durationMs,
        trace_id: entry.traceId,
        result: entry.result,
      });
    },
  };
}

export const POST = withRoute(async (request, context) => {
  requireRole(await requireUser(), ["admin"]);
  requireSameOrigin(request);
  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (!connection) {
    throw new AppError("E_NOT_FOUND", 404);
  }

  const env = getServerEnv();
  await refreshConnection(connection.id, {
    db,
    encryptionKey: decodeTokenEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
    oauthConfig: {
      clientId: env.AMO_CLIENT_ID,
      clientSecret: env.AMO_CLIENT_SECRET,
      redirectUri: env.AMO_REDIRECT_URI,
    },
    transport: { auditSink: auditSink(), traceId: context.traceId },
  });

  return { refreshed: true };
});
