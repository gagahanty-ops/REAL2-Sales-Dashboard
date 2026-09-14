import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createOAuthState, getAmoConnectionCredentials } from "@real2/db";
import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../../tests/helpers/local-db";

import { GET as callbackRoute } from "./callback/route";
import { POST as disconnectRoute } from "./disconnect/route";
import { POST as refreshRoute } from "./refresh/route";
import { POST as startRoute } from "./start/route";
import { GET as statusRoute } from "./status/route";

const syntheticTokenPair = {
  accessToken: "synthetic-access-callback",
  refreshToken: "synthetic-refresh-callback",
  expiresInSeconds: 3_600,
} as const;
const syntheticAccountId = 4_242;

const adminDb = createAdminDb();

const runtime = vi.hoisted(() => ({
  db: undefined as unknown,
  env: {
    APP_URL: "https://dashboard.example.test",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "synthetic-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    AMO_CLIENT_ID: "synthetic-client-id",
    AMO_CLIENT_SECRET: "synthetic-client-secret",
    AMO_REDIRECT_URI:
      "https://dashboard.example.test/api/integrations/amo/callback",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
    SYNC_ENABLED: false,
    SHEET_PUBLISH_ENABLED: false,
  },
}));

const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null,
  },
}));

vi.mock("../../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));

vi.mock("../../../../lib/server/runtime", () => ({
  getDatabase: () => runtime.db,
  getServerEnv: () => runtime.env,
}));

class AmoMock {
  readonly responses: Response[] = [];
  readonly requests: Array<{ url: string; init: RequestInit }> = [];

  readonly fetch = vi.fn(async (input: string | URL, init: RequestInit) => {
    this.requests.push({ url: String(input), init });
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected synthetic amoCRM request");
    return response;
  });

  queueTokenPair(tokenPair: {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
  }): void {
    this.responses.push(
      Response.json({
        token_type: "Bearer",
        expires_in: tokenPair.expiresInSeconds,
        access_token: tokenPair.accessToken,
        refresh_token: tokenPair.refreshToken,
      }),
    );
  }

  queueAccount(account: { id: number; subdomain: string }): void {
    this.responses.push(Response.json(account));
  }

  queueResponse(response: Response): void {
    this.responses.push(response);
  }

}

function callbackRequest(state: string, code: string): Request {
  const url = new URL(
    "/api/integrations/amo/callback",
    "https://dashboard.example.test",
  );
  url.searchParams.set("state", state);
  url.searchParams.set("code", code);
  return new Request(url);
}

function sameOriginPost(path: string): Request {
  return new Request(`https://dashboard.example.test${path}`, {
    method: "POST",
    headers: { origin: "https://dashboard.example.test" },
  });
}

async function connectionCount(): Promise<number> {
  const [row] = await adminDb<{ count: string }[]>`
    select count(*)::text as count from public.amo_connections
  `;
  return Number(row?.count ?? 0);
}

beforeEach(async () => {
  runtime.db = adminDb;
  session.user.role = "admin";
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
});

afterEach(async () => {
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await adminDb.end();
});

describe("amoCRM OAuth administration", () => {
  it("uses the start-created state to return to the implemented settings page", async () => {
    const response = await startRoute(
      sameOriginPost("/api/integrations/amo/start"),
    );
    const body = (await response.json()) as {
      data: { authorizationUrl: string };
    };
    const authorizationUrl = new URL(body.data.authorizationUrl);

    expect(response.status).toBe(200);
    expect(authorizationUrl.origin).toBe("https://www.amocrm.ru");
    expect(authorizationUrl.pathname).toBe("/oauth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "synthetic-client-id",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      runtime.env.AMO_REDIRECT_URI,
    );
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(authorizationUrl.searchParams.get("client_secret")).toBeNull();

    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    const callback = await callbackRoute(
      callbackRequest(authorizationUrl.searchParams.get("state")!, "synthetic-auth-code"),
    );

    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(
      "https://dashboard.example.test/settings/integrations/amo",
    );

    const [state] = await adminDb<{ created_by: string; consumed_at: Date | null }[]>`
      select created_by, consumed_at from public.oauth_states
    `;
    expect(state).toMatchObject({
      created_by: testUsers.admin.id,
      consumed_at: expect.any(Date),
    });
  });

  it("rejects an OAuth result bound to a different account", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: 999, subdomain: "another-account" });
    vi.stubGlobal("fetch", amoMock.fetch);

    const response = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );

    expect(response.status).toBe(409);
    expect(await connectionCount()).toBe(0);
  });

  it("accepts a verified account ID that differs from the fixed subdomain", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);

    const response = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );

    expect(response.status).toBe(303);
    expect(await connectionCount()).toBe(1);
  });

  it("rejects reinstallation when the verified numeric account ID changes", async () => {
    const firstState = await createOAuthState(adminDb, testUsers.admin.id);
    const secondState = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: 999, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);

    const first = await callbackRoute(
      callbackRequest(firstState.value, "synthetic-first-code"),
    );
    const second = await callbackRoute(
      callbackRequest(secondState.value, "synthetic-second-code"),
    );

    expect(first.status).toBe(303);
    expect(second.status).toBe(409);
    expect(await connectionCount()).toBe(1);
  });

  it("authenticates the active admin before consuming the one-time state", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    session.user.role = "head";

    const forbidden = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );
    session.user.role = "admin";
    const accepted = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );

    expect(forbidden.status).toBe(403);
    expect(accepted.status).toBe(303);
    expect(amoMock.requests).toHaveLength(2);
  });

  it("consumes state once and never exchanges a replayed code", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);

    const accepted = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );
    const replayed = await callbackRoute(
      callbackRequest(state.value, "synthetic-replayed-code"),
    );

    expect(accepted.status).toBe(303);
    expect(replayed.status).toBe(422);
    expect(amoMock.requests).toHaveLength(2);
  });

  it("uses only the guarded OAuth POST and account GET and returns a safe redirect", async () => {
    const state = await createOAuthState(
      adminDb,
      testUsers.admin.id,
      new Date(),
      "/settings/integrations/amo",
    );
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await callbackRoute(
      callbackRequest(state.value, "synthetic-auth-code"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://dashboard.example.test/settings/integrations/amo",
    );
    expect(response.headers.get("x-trace-id")).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{26}$/,
    );
    expect(await response.text()).toBe("");
    expect(amoMock.requests.map(({ url, init }) => [url, init.method])).toEqual([
      ["https://555151.amocrm.ru/oauth2/access_token", "POST"],
      ["https://555151.amocrm.ru/api/v4/account", "GET"],
    ]);
    expect(
      new Headers(amoMock.requests[0]?.init.headers).get("authorization"),
    ).toBeNull();
    expect(
      new Headers(amoMock.requests[1]?.init.headers).get("authorization"),
    ).toBe(`Bearer ${syntheticTokenPair.accessToken}`);
    expect(amoMock.requests.every(({ init }) => init.redirect === "error")).toBe(
      true,
    );

    const externallyVisible = JSON.stringify({
      body: await response.text(),
      location: response.headers.get("location"),
      logs: log.mock.calls,
    });
    expect(externallyVisible).not.toMatch(
      /synthetic-auth-code|synthetic-access|synthetic-refresh|synthetic-client-secret|state=/i,
    );
  });

  it("returns only the approved connection status fields", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    await callbackRoute(callbackRequest(state.value, "synthetic-auth-code"));

    const response = await statusRoute(
      new Request("https://dashboard.example.test/api/integrations/amo/status"),
    );
    const body = (await response.json()) as {
      data: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual([
      "accountId",
      "expiresAt",
      "lastCheckedAt",
      "status",
      "subdomain",
    ]);
    expect(body.data).toMatchObject({
      accountId: syntheticAccountId,
      subdomain: "555151",
      status: "active",
    });
    expect(body.data.expiresAt).toEqual(expect.any(String));
    expect(body.data.lastCheckedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(
      /access|refresh|ciphertext|client.secret|baseUrl|installedBy|synthetic/i,
    );
  });

  it("refreshes only the current connection server-side", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    amoMock.queueTokenPair({
      ...syntheticTokenPair,
      accessToken: "synthetic-access-refreshed",
      refreshToken: "synthetic-refresh-refreshed",
    });
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    await callbackRoute(callbackRequest(state.value, "synthetic-auth-code"));

    const response = await refreshRoute(
      sameOriginPost("/api/integrations/amo/refresh"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { refreshed: true } });
    expect(amoMock.requests.map(({ url, init }) => [url, init.method])).toEqual([
      ["https://555151.amocrm.ru/oauth2/access_token", "POST"],
      ["https://555151.amocrm.ru/api/v4/account", "GET"],
      ["https://555151.amocrm.ru/oauth2/access_token", "POST"],
      ["https://555151.amocrm.ru/api/v4/account", "GET"],
    ]);
  });

  it("fails closed without persisting mismatched refreshed credentials", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    amoMock.queueTokenPair({
      ...syntheticTokenPair,
      accessToken: "synthetic-access-refreshed",
      refreshToken: "synthetic-refresh-refreshed",
    });
    amoMock.queueAccount({ id: 999, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    await callbackRoute(callbackRequest(state.value, "synthetic-auth-code"));
    const [connection] = await adminDb<{ id: string }[]>`
      select id from public.amo_connections
    `;
    const beforeCredentials = await getAmoConnectionCredentials(
      adminDb,
      connection!.id,
    );
    const [before] = await adminDb<{ last_checked_at: Date }[]>`
      select last_checked_at from public.amo_connections
    `;

    const response = await refreshRoute(
      sameOriginPost("/api/integrations/amo/refresh"),
    );

    expect(response.status).toBe(502);
    const afterCredentials = await getAmoConnectionCredentials(
      adminDb,
      connection!.id,
    );
    expect(afterCredentials.status).toBe("reauth_required");
    expect(afterCredentials.accessTokenCiphertext).toEqual(
      beforeCredentials.accessTokenCiphertext,
    );
    expect(afterCredentials.refreshTokenCiphertext).toEqual(
      beforeCredentials.refreshTokenCiphertext,
    );
    const [after] = await adminDb<{ last_checked_at: Date }[]>`
      select last_checked_at from public.amo_connections
    `;
    expect(after?.last_checked_at).toEqual(before?.last_checked_at);
    expect(amoMock.requests.map(({ url, init }) => [url, init.method])).toEqual([
      ["https://555151.amocrm.ru/oauth2/access_token", "POST"],
      ["https://555151.amocrm.ru/api/v4/account", "GET"],
      ["https://555151.amocrm.ru/oauth2/access_token", "POST"],
      ["https://555151.amocrm.ru/api/v4/account", "GET"],
    ]);
  });

  it("exposes reauth_required after a failed refresh for the client status reload", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    amoMock.queueResponse(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", amoMock.fetch);
    await callbackRoute(callbackRequest(state.value, "synthetic-auth-code"));

    const refresh = await refreshRoute(
      sameOriginPost("/api/integrations/amo/refresh"),
    );
    const status = await statusRoute(
      new Request("https://dashboard.example.test/api/integrations/amo/status"),
    );

    expect(refresh.status).toBe(502);
    expect((await status.json() as { data: { status: string } }).data.status).toBe(
      "reauth_required",
    );
    expect(amoMock.requests).toHaveLength(3);
  });

  it("disconnects locally without an amoCRM business request", async () => {
    const state = await createOAuthState(adminDb, testUsers.admin.id);
    const amoMock = new AmoMock();
    amoMock.queueTokenPair(syntheticTokenPair);
    amoMock.queueAccount({ id: syntheticAccountId, subdomain: "555151" });
    vi.stubGlobal("fetch", amoMock.fetch);
    await callbackRoute(callbackRequest(state.value, "synthetic-auth-code"));

    const response = await disconnectRoute(
      sameOriginPost("/api/integrations/amo/disconnect"),
    );
    const status = await statusRoute(
      new Request("https://dashboard.example.test/api/integrations/amo/status"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { disconnected: true } });
    expect((await status.json() as { data: { status: string } }).data.status).toBe(
      "disabled",
    );
    expect(amoMock.requests).toHaveLength(2);
  });

  it("rejects a non-admin before creating state or changing a connection", async () => {
    session.user.role = "head";

    const start = await startRoute(sameOriginPost("/api/integrations/amo/start"));
    const refresh = await refreshRoute(
      sameOriginPost("/api/integrations/amo/refresh"),
    );
    const disconnect = await disconnectRoute(
      sameOriginPost("/api/integrations/amo/disconnect"),
    );

    expect([start.status, refresh.status, disconnect.status]).toEqual([403, 403, 403]);
    expect(await connectionCount()).toBe(0);
    const [state] = await adminDb<{ count: string }[]>`
      select count(*)::text as count from public.oauth_states
    `;
    expect(Number(state?.count ?? 0)).toBe(0);
  });
});
