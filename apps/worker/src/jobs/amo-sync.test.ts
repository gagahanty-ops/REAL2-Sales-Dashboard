import { describe, expect, it, vi } from "vitest";

import {
  createAmoSyncRunner,
  type AmoSyncDependencies,
  type Clock,
} from "./amo-sync";

const fixedNow = new Date("2026-09-15T09:00:00.000Z");

function createClock(): Clock & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => fixedNow,
    random: () => 0,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  };
}

function disabledHarness(envEnabled: boolean, dbEnabled: boolean) {
  const tokenProvider = { getAccessToken: vi.fn(async () => "test-token") };
  const requestPage = vi.fn();
  const acquire = vi.fn();
  const dependencies = {
    envEnabled,
    controls: { isSyncEnabled: vi.fn(async () => dbEnabled) },
    connections: { getActive: vi.fn() },
    configs: { getActive: vi.fn() },
    locks: { withSyncLock: acquire },
    cursors: { get: vi.fn() },
    runs: { start: vi.fn(), finish: vi.fn() },
    raw: { appendPage: vi.fn(), quarantinePage: vi.fn() },
    transport: { requestPage },
    tokens: { createProvider: vi.fn(() => tokenProvider), refresh: vi.fn() },
    reconciliation: { previousFullLeadCount: vi.fn() },
  } as unknown as AmoSyncDependencies;
  return { dependencies, acquire, requestPage, tokenProvider };
}

describe("amoCRM read-only sync", () => {
  it.each([
    { envEnabled: false, dbEnabled: false },
    { envEnabled: false, dbEnabled: true },
    { envEnabled: true, dbEnabled: false },
  ])(
    "does not acquire a token or call the network when env=$envEnabled db=$dbEnabled",
    async ({ envEnabled, dbEnabled }) => {
      const harness = disabledHarness(envEnabled, dbEnabled);
      const result = await createAmoSyncRunner(harness.dependencies)(
        "incremental",
        createClock(),
      );

      expect(result).toEqual({ kind: "disabled" });
      expect(harness.acquire).not.toHaveBeenCalled();
      expect(harness.tokenProvider.getAccessToken).not.toHaveBeenCalled();
      expect(harness.requestPage).not.toHaveBeenCalled();
    },
  );

  it("does not advance cursors when page three fails after five retries", async () => {
    const clock = createClock();
    const finished: unknown[] = [];
    const paths: string[] = [];
    const dependencies = {
      envEnabled: true,
      controls: { isSyncEnabled: vi.fn(async () => true) },
      connections: {
        getActive: vi.fn(async () => ({
          id: "connection-1",
          accountId: 9001,
          baseUrl: "https://555151.amocrm.ru",
        })),
      },
      configs: {
        getActive: vi.fn(async () => ({ id: "config-1", pipelineId: 77 })),
      },
      locks: {
        withSyncLock: vi.fn(async (_connectionId, action) => action()),
      },
      cursors: {
        get: vi.fn(async () => ({
          events: {
            cursorTime: new Date("2026-09-15T08:30:00.000Z"),
            cursorExternalId: "event-before",
          },
        })),
      },
      runs: {
        start: vi.fn(async () => ({ id: "run-1", traceId: "trace-1" })),
        finish: vi.fn(async (_runId, outcome) => {
          finished.push(outcome);
        }),
      },
      raw: { appendPage: vi.fn(), quarantinePage: vi.fn() },
      transport: {
        requestPage: vi.fn(async (request) => {
          paths.push(request.url);
          if (request.url.includes("/account")) {
            return { id: 9001, subdomain: "555151" };
          }
          if (request.url.includes("/pipelines/77/statuses")) {
            return { _embedded: { statuses: [] } };
          }
          if (request.url.includes("/pipelines")) {
            return { _embedded: { pipelines: [] } };
          }
          if (request.url.includes("/users")) {
            return { _embedded: { users: [] } };
          }
          if (request.url.includes("/events")) {
            return { _embedded: { events: [] } };
          }
          if (request.url.includes("page=3")) {
            throw Object.assign(new Error("upstream"), {
              code: "E_AMO_UPSTREAM",
              responseStatus: 503,
            });
          }
          const page = request.url.includes("page=2") ? 2 : 1;
          return {
            _embedded: { leads: [{ id: page, account_id: 9001, created_at: 1, updated_at: 1 }] },
            _links: {
              next: {
                href: `https://555151.amocrm.ru/api/v4/leads?page=${page + 1}`,
              },
            },
          };
        }),
      },
      tokens: {
        createProvider: vi.fn(() => ({ getAccessToken: vi.fn(async () => "test-token") })),
        refresh: vi.fn(),
      },
      reconciliation: { previousFullLeadCount: vi.fn(async () => null) },
    } as unknown as AmoSyncDependencies;

    const result = await createAmoSyncRunner(dependencies)("incremental", clock);

    expect(result).toMatchObject({ status: "partial", runId: "run-1" });
    expect(clock.sleeps).toEqual([1_000, 3_000, 9_000, 27_000, 60_000]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ status: "partial" });
    expect(finished[0]).not.toHaveProperty("nextCursors");
    expect(paths.filter((path) => path.includes("page=3"))).toHaveLength(6);
  });

  it("quarantines the exact malformed 200 payload and does not retry it", async () => {
    const malformed = { id: "not-an-account-id", diagnostic: "synthetic" };
    const quarantined: unknown[] = [];
    const requestPage = vi.fn(async () => malformed);
    const dependencies = {
      envEnabled: true,
      controls: { isSyncEnabled: vi.fn(async () => true) },
      connections: {
        getActive: vi.fn(async () => ({
          id: "connection-1",
          accountId: 9001,
          baseUrl: "https://555151.amocrm.ru",
        })),
      },
      configs: { getActive: vi.fn(async () => ({ id: "config-1", pipelineId: 77 })) },
      locks: { withSyncLock: vi.fn(async (_id, action) => action()) },
      cursors: { get: vi.fn(async () => ({})) },
      runs: {
        start: vi.fn(async () => ({ id: "run-1", traceId: "trace-1" })),
        finish: vi.fn(),
      },
      raw: {
        appendPage: vi.fn(),
        quarantinePage: vi.fn(async (input) => {
          quarantined.push(input);
        }),
      },
      transport: { requestPage },
      tokens: {
        createProvider: vi.fn(() => ({ getAccessToken: vi.fn() })),
        refresh: vi.fn(),
      },
      reconciliation: { previousFullLeadCount: vi.fn() },
    } as unknown as AmoSyncDependencies;

    await expect(
      createAmoSyncRunner(dependencies)("incremental", createClock()),
    ).resolves.toMatchObject({ status: "partial" });
    expect(requestPage).toHaveBeenCalledOnce();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ payload: malformed });
  });
});
