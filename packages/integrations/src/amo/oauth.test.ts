import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAmoConnection,
  createOAuthState,
  disableAmoConnection,
  getAmoConnectionCredentials,
  getSafeAmoConnectionStatus,
  purgeExpiredOAuthStates,
  consumeOAuthState,
  withLockedAmoConnection,
} from "@real2/db";
import { AppError } from "@real2/domain";
import {
  createAmoTokenProvider,
  refreshConnection,
  refreshDueConnections,
  type RefreshedAccessTokenValidator,
} from "./refresh";
import { localDatabaseUrl, resetAndSeedUsers, testUsers } from "../../../../tests/helpers/local-db";
import { decryptToken, encryptToken } from "./crypto";
import { exchangeAuthorizationCode } from "./oauth";

const encryptionKey = Buffer.from("local-synthetic-encryption-key!!");
const now = new Date("2026-09-12T12:00:00.000Z");
const tokenEndpoint = "https://555151.amocrm.ru/oauth2/access_token";

const oauthConfig = {
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://dashboard.example.invalid/api/integrations/amo/callback",
} as const;

const validateRefreshedAccessToken: RefreshedAccessTokenValidator = async () =>
  undefined;

const adminDb = postgres(localDatabaseUrl, { max: 4 });

function tokenResponse(
  accessToken = "synthetic-access-next",
  refreshToken = "synthetic-refresh-next",
): Response {
  return new Response(
    JSON.stringify({
      token_type: "Bearer",
      expires_in: 86_400,
      access_token: accessToken,
      refresh_token: refreshToken,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function createOAuthTransport(response: Response = tokenResponse()) {
  const audits: unknown[] = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: string | URL, init: RequestInit) => {
    requests.push({ url: String(url), init });
    return response.clone();
  });

  return {
    audits,
    requests,
    fetchFn,
    transport: {
      fetchFn,
      auditSink: {
        record(entry: unknown) {
          audits.push(entry);
        },
      },
      traceId: "01J00000000000000000000000",
    },
  };
}

async function insertConnection(overrides: {
  accountId?: number;
  subdomain?: string;
  tokenExpiresAt?: Date;
} = {}) {
  return createAmoConnection(adminDb, {
    accountId: overrides.accountId ?? 555_151,
    subdomain: overrides.subdomain ?? "555151",
    baseUrl: "https://555151.amocrm.ru",
    accessTokenCiphertext: encryptToken("synthetic-access-old", encryptionKey),
    refreshTokenCiphertext: encryptToken("synthetic-refresh-old", encryptionKey),
    tokenExpiresAt:
      overrides.tokenExpiresAt ?? new Date(now.getTime() + 5 * 60_000),
    status: "active",
    installedBy: testUsers.admin.id,
    lastCheckedAt: now,
  });
}

beforeEach(async () => {
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  await resetAndSeedUsers(adminDb, [
    testUsers.admin,
    testUsers.head,
    testUsers.managerOne,
  ]);
});

afterEach(async () => {
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
});

afterAll(async () => {
  await adminDb.end();
});

describe("OAuth state storage", () => {
  it("consumes a state exactly once within ten minutes", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id, now);

    await expect(
      consumeOAuthState(
        adminDb,
        state.value,
        new Date(now.getTime() + 9 * 60_000),
      ),
    ).resolves.toMatchObject({ createdBy: testUsers.admin.id });
    await expect(
      consumeOAuthState(
        adminDb,
        state.value,
        new Date(now.getTime() + 9 * 60_000),
      ),
    ).rejects.toThrow("E_CONFLICT");
  });

  it("rejects an expired state without consuming it", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id, now);

    await expect(
      consumeOAuthState(
        adminDb,
        state.value,
        new Date(now.getTime() + 10 * 60_000 + 1),
      ),
    ).rejects.toThrow("E_CONFLICT");
  });

  it("purges states only after their post-expiry retention period", async () => {
    await createOAuthState(
      adminDb,
      testUsers.admin.id,
      new Date(now.getTime() - 24 * 60 * 60_000 - 10 * 60_001),
    );
    await createOAuthState(adminDb, testUsers.admin.id, now);

    await expect(purgeExpiredOAuthStates(adminDb, now)).resolves.toBe(1);
  });
});

describe("OAuth token encryption", () => {
  it("uses a fresh authenticated ciphertext for every token", () => {
    const first = encryptToken("synthetic-secret", encryptionKey);
    const second = encryptToken("synthetic-secret", encryptionKey);

    expect(first).not.toEqual(second);
    expect(first.includes(Buffer.from("synthetic-secret"))).toBe(false);
    expect(decryptToken(first, encryptionKey)).toBe("synthetic-secret");
    expect(decryptToken(second, encryptionKey)).toBe("synthetic-secret");
  });

  it("rejects keys that are not exactly 32 bytes", () => {
    expect(() => encryptToken("synthetic-secret", Buffer.alloc(31))).toThrow(
      "E_CONFIG_INCOMPLETE",
    );
  });
});

describe("OAuth exchange", () => {
  it("uses the guarded OAuth POST without bearer auth or unsafe audit fields", async () => {
    const { audits, requests, transport } = createOAuthTransport();

    await expect(
      exchangeAuthorizationCode("synthetic-code", oauthConfig, transport),
    ).resolves.toMatchObject({ expiresInSeconds: 86_400 });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(tokenEndpoint);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      redirect: "error",
    });
    expect((requests[0]?.init.headers as Headers).get("authorization")).toBeNull();
    expect(String(requests[0]?.init.body)).toContain("authorization_code");
    expect(JSON.stringify(audits)).not.toMatch(
      /synthetic-code|synthetic-client-secret|synthetic-access-next|synthetic-refresh-next/i,
    );
  });

  it("maps malformed upstream data to a safe error", async () => {
    const malformed = new Response(
      JSON.stringify({ access_token: "synthetic-leaked-token" }),
      { status: 200 },
    );
    const { transport } = createOAuthTransport(malformed);

    const exchange = exchangeAuthorizationCode(
      "synthetic-code",
      oauthConfig,
      transport,
    );

    await expect(exchange).rejects.toMatchObject({ code: "E_AMO_UPSTREAM" });
    await expect(exchange).rejects.not.toThrow("synthetic-leaked-token");
  });
});

describe("amoCRM connection repository", () => {
  it("returns a status projection that cannot serialize token material", async () => {
    const connection = await insertConnection();

    const status = await getSafeAmoConnectionStatus(adminDb, connection.id);

    expect(status).toMatchObject({
      id: connection.id,
      accountId: 555_151,
      subdomain: "555151",
      status: "active",
    });
    expect(JSON.stringify(status)).not.toMatch(
      /access_token|refresh_token|ciphertext|synthetic-secret/i,
    );
  });

  it("overwrites both ciphertexts when a connection is disabled", async () => {
    const connection = await insertConnection();
    const before = await getAmoConnectionCredentials(adminDb, connection.id);

    await disableAmoConnection(adminDb, connection.id, now);

    const after = await getAmoConnectionCredentials(adminDb, connection.id);
    expect(after.status).toBe("disabled");
    expect(after.accessTokenCiphertext).not.toEqual(before.accessTokenCiphertext);
    expect(after.refreshTokenCiphertext).not.toEqual(before.refreshTokenCiphertext);
    expect(() => decryptToken(after.accessTokenCiphertext, encryptionKey)).toThrow(
      "E_AMO_AUTH",
    );
    expect(() => decryptToken(after.refreshTokenCiphertext, encryptionKey)).toThrow(
      "E_AMO_AUTH",
    );
  });
});

describe("token rotation", () => {
  it("takes a transaction-scoped advisory lock for a connection", async () => {
    const connection = await insertConnection();

    await withLockedAmoConnection(adminDb, connection.id, async () => {
      const [lockAttempt] = await adminDb<{ acquired: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0))
          as acquired
      `;

      expect(lockAttempt?.acquired).toBe(false);
    });
  });

  it("rotates the whole token pair once across concurrent refreshes", async () => {
    const connection = await insertConnection();
    const audits: unknown[] = [];
    let releaseUpstream!: () => void;
    let signalUpstreamStarted!: () => void;
    const upstreamGate = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    const upstreamStarted = new Promise<void>((resolve) => {
      signalUpstreamStarted = resolve;
    });
    const fetchFn = vi.fn(async () => {
      signalUpstreamStarted();
      await upstreamGate;
      return tokenResponse();
    });
    const transport = {
      fetchFn,
      auditSink: {
        record(entry: unknown) {
          audits.push(entry);
        },
      },
      traceId: "01J00000000000000000000000",
    };
    const dependencies = {
      db: adminDb,
      encryptionKey,
      oauthConfig,
      transport,
      validateRefreshedAccessToken,
    };

    const firstPromise = refreshConnection(connection.id, dependencies, now);
    const secondPromise = refreshConnection(connection.id, dependencies, now);
    await upstreamStarted;
    releaseUpstream();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe("synthetic-access-next");
    expect(second).toBe("synthetic-access-next");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const stored = await getAmoConnectionCredentials(adminDb, connection.id);
    expect(decryptToken(stored.accessTokenCiphertext, encryptionKey)).toBe(
      "synthetic-access-next",
    );
    expect(decryptToken(stored.refreshTokenCiphertext, encryptionKey)).toBe(
      "synthetic-refresh-next",
    );
    expect(stored.refreshedAt).toEqual(now);
    expect(JSON.stringify(audits)).not.toMatch(
      /synthetic-access|synthetic-refresh|synthetic-client-secret/i,
    );
  });

  it("does not mistake a later explicit refresh for a concurrent waiter", async () => {
    const connection = await insertConnection();
    const { fetchFn, transport } = createOAuthTransport();
    const dependencies = {
      db: adminDb,
      encryptionKey,
      oauthConfig,
      transport,
      validateRefreshedAccessToken,
    };

    await refreshConnection(connection.id, dependencies, now);
    await refreshConnection(connection.id, dependencies, now);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("marks the connection reauth_required when refresh fails", async () => {
    const connection = await insertConnection();
    const { transport } = createOAuthTransport(
      new Response(JSON.stringify({ message: "synthetic-upstream-detail" }), {
        status: 500,
      }),
    );

    const refresh = refreshConnection(
      connection.id,
      {
        db: adminDb,
        encryptionKey,
        oauthConfig,
        transport,
        validateRefreshedAccessToken,
      },
      now,
    );

    await expect(refresh).rejects.toMatchObject({ code: "E_AMO_AUTH" });
    await expect(refresh).rejects.not.toThrow("synthetic-upstream-detail");
    await expect(
      getSafeAmoConnectionStatus(adminDb, connection.id),
    ).resolves.toMatchObject({ status: "reauth_required" });

    const provider = createAmoTokenProvider(connection.id, {
      db: adminDb,
      encryptionKey,
      oauthConfig,
      transport,
      validateRefreshedAccessToken,
      now: () => now,
    });
    await expect(provider.getAccessToken()).rejects.toEqual(
      new AppError("E_AMO_AUTH", 502),
    );
  });

  it("starts proactive refresh at the exact ten-minute boundary", async () => {
    const due = await insertConnection({
      accountId: 555_151,
      subdomain: "555151",
      tokenExpiresAt: new Date(now.getTime() + 10 * 60_000),
    });
    await insertConnection({
      accountId: 555_152,
      subdomain: "555152",
      tokenExpiresAt: new Date(now.getTime() + 10 * 60_000 + 1),
    });
    const { fetchFn, transport } = createOAuthTransport();

    await expect(
      refreshDueConnections(
        {
          db: adminDb,
          encryptionKey,
          oauthConfig,
          transport,
          validateRefreshedAccessToken,
        },
        now,
      ),
    ).resolves.toEqual([due.id]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("provides tokens only for an active connection", async () => {
    const connection = await insertConnection({
      tokenExpiresAt: new Date(now.getTime() + 60 * 60_000),
    });
    const { transport } = createOAuthTransport();
    const provider = createAmoTokenProvider(connection.id, {
      db: adminDb,
      encryptionKey,
      oauthConfig,
      transport,
      validateRefreshedAccessToken,
      now: () => now,
    });

    await expect(provider.getAccessToken()).resolves.toBe(
      "synthetic-access-old",
    );
    await disableAmoConnection(adminDb, connection.id, now);
    await expect(provider.getAccessToken()).rejects.toEqual(
      new AppError("E_AMO_AUTH", 502),
    );
  });
});
