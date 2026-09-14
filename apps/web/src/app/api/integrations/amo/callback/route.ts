import {
  consumeOAuthState,
  createAmoConnection,
  getCurrentSafeAmoConnectionStatus,
  withLockedAmoConnection,
} from "@real2/db";
import { AppError } from "@real2/domain";
import {
  amoFetch,
  decodeTokenEncryptionKey,
  encryptToken,
  exchangeAuthorizationCode,
  type AmoAuditEntry,
  type AmoAuditSink,
} from "@real2/integrations";
import { z } from "zod";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { withRoute } from "../../../../../lib/http/route";
import { safeLogger } from "../../../../../lib/logging/logger";
import {
  getDatabase,
  getServerEnv,
} from "../../../../../lib/server/runtime";

const AMO_BASE_URL = "https://555151.amocrm.ru";
const AMO_ACCOUNT_ID = 555_151;
const AMO_SUBDOMAIN = "555151";
const SAFE_REDIRECTS = new Set([
  "/settings/integrations",
  "/settings/integrations/amo",
]);

const callbackSchema = z.strictObject({
  code: z.string().min(1).max(4_096),
  state: z.string().min(1).max(512),
});

const accountSchema = z.object({
  id: z.number().int().positive(),
  subdomain: z.string().regex(/^[a-z0-9-]+$/),
});

function auditSink(): AmoAuditSink {
  return {
    record(entry: AmoAuditEntry) {
      const completed = entry.result === "success";
      const log = completed ? safeLogger.info : safeLogger.error;
      log({
        message: completed ? "request completed" : "request failed",
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

function safeRedirect(redirectAfter: string, appUrl: string): Response {
  if (!SAFE_REDIRECTS.has(redirectAfter)) {
    throw new AppError("E_FORBIDDEN", 403);
  }
  return new Response(null, {
    status: 303,
    headers: { location: new URL(redirectAfter, appUrl).toString() },
  });
}

export const GET = withRoute(async (request, context) => {
  const admin = requireRole(await requireUser(), ["admin"]);
  const requestUrl = new URL(request.url);
  const input = callbackSchema.parse({
    code: requestUrl.searchParams.get("code"),
    state: requestUrl.searchParams.get("state"),
  });
  const db = getDatabase();
  const oauthState = await consumeOAuthState(db, input.state);

  if (oauthState.createdBy !== admin.id) {
    throw new AppError("E_FORBIDDEN", 403);
  }

  const env = getServerEnv();
  const transport = {
    auditSink: auditSink(),
    traceId: context.traceId,
  };
  const tokenPair = await exchangeAuthorizationCode(input.code, {
    clientId: env.AMO_CLIENT_ID,
    clientSecret: env.AMO_CLIENT_SECRET,
    redirectUri: env.AMO_REDIRECT_URI,
  }, transport);
  const account = await amoFetch({
    method: "GET",
    url: `${AMO_BASE_URL}/api/v4/account`,
    schema: accountSchema,
    traceId: context.traceId,
    tokenProvider: {
      async getAccessToken() {
        return tokenPair.accessToken;
      },
    },
    auditSink: transport.auditSink,
    redirect: "error",
  });

  if (
    account.id !== AMO_ACCOUNT_ID ||
    account.subdomain !== AMO_SUBDOMAIN ||
    `${account.subdomain}.amocrm.ru` !== new URL(AMO_BASE_URL).hostname
  ) {
    throw new AppError("E_CONFLICT", 409);
  }

  const existing = await getCurrentSafeAmoConnectionStatus(db);
  if (
    existing &&
    (existing.accountId !== account.id ||
      existing.subdomain !== account.subdomain ||
      existing.baseUrl !== AMO_BASE_URL)
  ) {
    throw new AppError("E_CONFLICT", 409);
  }

  const now = new Date();
  const encryptionKey = decodeTokenEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  const accessTokenCiphertext = encryptToken(
    tokenPair.accessToken,
    encryptionKey,
  );
  const refreshTokenCiphertext = encryptToken(
    tokenPair.refreshToken,
    encryptionKey,
  );
  const tokenExpiresAt = new Date(
    now.getTime() + tokenPair.expiresInSeconds * 1_000,
  );

  if (existing) {
    await withLockedAmoConnection(db, existing.id, async (connection, actions) => {
      if (
        connection.accountId !== account.id ||
        connection.subdomain !== account.subdomain ||
        connection.baseUrl !== AMO_BASE_URL
      ) {
        throw new AppError("E_CONFLICT", 409);
      }
      await actions.rotateTokens({
        accessTokenCiphertext,
        refreshTokenCiphertext,
        tokenExpiresAt,
        refreshedAt: now,
      });
    });
  } else {
    await createAmoConnection(db, {
      accountId: account.id,
      subdomain: account.subdomain,
      baseUrl: AMO_BASE_URL,
      accessTokenCiphertext,
      refreshTokenCiphertext,
      tokenExpiresAt,
      status: "active",
      installedBy: admin.id,
    });
  }

  return safeRedirect(oauthState.redirectAfter, env.APP_URL);
});
