import { z } from "zod";

import type { AmoAuditSink, AmoFetchFn } from "./types";
import { amoFetch } from "./transport";

const AMO_TOKEN_ENDPOINT = "https://555151.amocrm.ru/oauth2/access_token";

const tokenResponseSchema = z
  .object({
    token_type: z.string().min(1),
    expires_in: z.number().int().positive(),
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
  })
  .strict();

export type AmoOAuthConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

export type AmoOAuthTransport = Readonly<{
  fetchFn: AmoFetchFn;
  auditSink: AmoAuditSink;
  traceId: string;
}>;

export type AmoTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}>;

const oauthTokenProvider = {
  async getAccessToken(): Promise<string> {
    throw new Error("OAuth requests must not resolve a bearer token");
  },
};

async function exchangeToken(
  payload: Record<string, string>,
  transport: AmoOAuthTransport,
): Promise<AmoTokenPair> {
  const response = await amoFetch({
    method: "POST",
    url: AMO_TOKEN_ENDPOINT,
    schema: tokenResponseSchema,
    traceId: transport.traceId,
    tokenProvider: oauthTokenProvider,
    fetchFn: transport.fetchFn,
    auditSink: transport.auditSink,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
  });

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresInSeconds: response.expires_in,
  };
}

export function exchangeAuthorizationCode(
  code: string,
  config: AmoOAuthConfig,
  transport: AmoOAuthTransport,
): Promise<AmoTokenPair> {
  return exchangeToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    },
    transport,
  );
}

export function refreshOAuthToken(
  refreshToken: string,
  config: AmoOAuthConfig,
  transport: AmoOAuthTransport,
): Promise<AmoTokenPair> {
  return exchangeToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: config.redirectUri,
    },
    transport,
  );
}
