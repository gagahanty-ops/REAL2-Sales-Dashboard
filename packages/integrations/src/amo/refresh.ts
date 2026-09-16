import {
  findDueAmoConnectionIds,
  getAmoConnectionCredentials,
  withLockedAmoConnection,
  type AmoConnectionCredentials,
  type Database,
} from "@real2/db";
import { AppError } from "@real2/domain";

import { decryptToken, encryptToken, type TokenEncryptionKey } from "./crypto";
import {
  refreshOAuthToken,
  type AmoOAuthConfig,
  type AmoOAuthTransport,
} from "./oauth";
import type { AmoTokenProvider } from "./types";

const REFRESH_WINDOW_MS = 10 * 60_000;
const inFlightRefreshes = new Map<string, Promise<string>>();

export type RefreshedAccessTokenValidator = (
  accessToken: string,
  connection: Pick<AmoConnectionCredentials, "accountId" | "subdomain" | "baseUrl">,
) => Promise<void>;

export type RefreshAmoTokenDependencies = Readonly<{
  db: Database;
  encryptionKey: TokenEncryptionKey;
  oauthConfig: AmoOAuthConfig;
  transport: AmoOAuthTransport;
  validateRefreshedAccessToken: RefreshedAccessTokenValidator;
  assertFence?: () => void | Promise<void>;
}>;

type TokenProviderDependencies = RefreshAmoTokenDependencies &
  Readonly<{ now?: () => Date }>;

type RefreshResult =
  | Readonly<{ ok: true; accessToken: string }>
  | Readonly<{ ok: false; error: AppError }>;

async function assertFence(
  dependencies: Pick<RefreshAmoTokenDependencies, "assertFence">,
): Promise<void> {
  await dependencies.assertFence?.();
}

export async function refreshConnection(
  connectionId: string,
  dependencies: RefreshAmoTokenDependencies,
  now = new Date(),
): Promise<string> {
  const inFlight = inFlightRefreshes.get(connectionId);
  if (inFlight) return inFlight;

  const refresh = refreshConnectionLocked(connectionId, dependencies, now);
  inFlightRefreshes.set(connectionId, refresh);

  try {
    return await refresh;
  } finally {
    if (inFlightRefreshes.get(connectionId) === refresh) {
      inFlightRefreshes.delete(connectionId);
    }
  }
}

async function refreshConnectionLocked(
  connectionId: string,
  dependencies: RefreshAmoTokenDependencies,
  now: Date,
): Promise<string> {
  const observedConnection = await getAmoConnectionCredentials(
    dependencies.db,
    connectionId,
  );
  const result = await withLockedAmoConnection(
    dependencies.db,
    connectionId,
    async (connection, actions): Promise<RefreshResult> => {
      if (connection.status !== "active") {
        return { ok: false, error: new AppError("E_AMO_AUTH", 502) };
      }

      if (
        !connection.refreshTokenCiphertext.equals(
          observedConnection.refreshTokenCiphertext,
        )
      ) {
        return {
          ok: true,
          accessToken: decryptToken(
            connection.accessTokenCiphertext,
            dependencies.encryptionKey,
          ),
        };
      }

      try {
        const currentRefreshToken = decryptToken(
          connection.refreshTokenCiphertext,
          dependencies.encryptionKey,
        );
        await assertFence(dependencies);
        const tokenPair = await refreshOAuthToken(
          currentRefreshToken,
          dependencies.oauthConfig,
          {
            ...dependencies.transport,
            ...(dependencies.assertFence
              ? { beforeNetwork: dependencies.assertFence }
              : {}),
          },
        );
        await assertFence(dependencies);
        await dependencies.validateRefreshedAccessToken(
          tokenPair.accessToken,
          connection,
        );
        await assertFence(dependencies);
        const tokenExpiresAt = new Date(
          now.getTime() + tokenPair.expiresInSeconds * 1_000,
        );

        await actions.rotateTokens({
          accessTokenCiphertext: encryptToken(
            tokenPair.accessToken,
            dependencies.encryptionKey,
          ),
          refreshTokenCiphertext: encryptToken(
            tokenPair.refreshToken,
            dependencies.encryptionKey,
          ),
          tokenExpiresAt,
          refreshedAt: now,
        });
        await assertFence(dependencies);
        await actions.markCheckedAt(now);

        return { ok: true, accessToken: tokenPair.accessToken };
      } catch (error) {
        if (error instanceof AppError && error.code === "E_SYNC_FENCE_LOST") {
          throw error;
        }
        await assertFence(dependencies);
        await actions.markReauthRequired(now);
        return { ok: false, error: new AppError("E_AMO_AUTH", 502) };
      }
    },
  );

  if (!result.ok) throw result.error;
  return result.accessToken;
}

export async function refreshDueConnections(
  dependencies: RefreshAmoTokenDependencies,
  now = new Date(),
): Promise<string[]> {
  const cutoff = new Date(now.getTime() + REFRESH_WINDOW_MS);
  const connectionIds = await findDueAmoConnectionIds(dependencies.db, cutoff);

  for (const connectionId of connectionIds) {
    await refreshConnection(connectionId, dependencies, now);
  }

  return connectionIds;
}

export function createAmoTokenProvider(
  connectionId: string,
  dependencies: TokenProviderDependencies,
): AmoTokenProvider {
  return {
    async getAccessToken() {
      const now = dependencies.now?.() ?? new Date();
      await assertFence(dependencies);
      const connection = await getAmoConnectionCredentials(
        dependencies.db,
        connectionId,
      );

      if (connection.status !== "active") {
        throw new AppError("E_AMO_AUTH", 502);
      }

      if (
        connection.tokenExpiresAt.getTime() <=
        now.getTime() + REFRESH_WINDOW_MS
      ) {
        return refreshConnection(connectionId, dependencies, now);
      }

      await assertFence(dependencies);
      return decryptToken(
        connection.accessTokenCiphertext,
        dependencies.encryptionKey,
      );
    },
  };
}
