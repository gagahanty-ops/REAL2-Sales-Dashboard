import { describe, expect, it, vi } from "vitest";

import { AppError } from "@real2/domain";

import {
  createAmoSyncRunner,
  processSyncWorkQueue,
  type AmoSyncDependencies,
  type Clock,
} from "./amo-sync";

const fixedNow = new Date("2026-09-15T09:00:00.000Z");
const testFence = {
  backendPid: 1,
  assertOwned: vi.fn(async () => undefined),
};

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
        withSyncLock: vi.fn(async (_connectionId, action) => action(testFence)),
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
    expect(finished[0]).toMatchObject({
      status: "partial",
      counts: { leadsRead: 2 },
    });
    expect(finished[0]).toMatchObject({
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
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
      locks: { withSyncLock: vi.fn(async (_id, action) => action(testFence)) },
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

  it("propagates manual queue trace and requester attribution into the sync run", async () => {
    const started: unknown[] = [];
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
      locks: { withSyncLock: vi.fn(async (_id, action) => action(testFence)) },
      cursors: { get: vi.fn(async () => ({})) },
      runs: {
        start: vi.fn(async (input) => {
          started.push(input);
          return { id: "run-1", traceId: input.traceId };
        }),
        finish: vi.fn(),
      },
      raw: { appendPage: vi.fn(), quarantinePage: vi.fn() },
      transport: {
        requestPage: vi.fn(async (request) => {
          if (request.url.includes("/account")) return { id: 9001, subdomain: "555151" };
          if (request.url.includes("/pipelines/77/statuses")) return { _embedded: { statuses: [] } };
          if (request.url.includes("/pipelines")) return { _embedded: { pipelines: [] } };
          if (request.url.includes("/users")) return { _embedded: { users: [] } };
          if (request.url.includes("/events")) return { _embedded: { events: [] } };
          return { _embedded: { leads: [] } };
        }),
      },
      tokens: {
        createProvider: vi.fn(() => ({ getAccessToken: vi.fn(async () => "test-token") })),
        refresh: vi.fn(),
      },
      reconciliation: { previousFullLeadCount: vi.fn(async () => null) },
    } as unknown as AmoSyncDependencies;

    await expect(
      createAmoSyncRunner(dependencies)("manual", createClock(), {
        traceId: "manual-request-trace",
        requestedBy: "10000000-0000-4000-8000-000000000010",
      }),
    ).resolves.toMatchObject({
      status: "success",
      traceId: "manual-request-trace",
    });

    expect(started[0]).toMatchObject({
      traceId: "manual-request-trace",
      createdBy: "10000000-0000-4000-8000-000000000010",
    });
  });

  it("executes one claimed queue item and records a terminal queue state", async () => {
    const completed: unknown[] = [];
    const run = vi.fn(async () => ({
      status: "success" as const,
      runId: "run-1",
      traceId: "queued-trace",
    }));

    await expect(processSyncWorkQueue({
      now: () => fixedNow,
      claim: vi.fn(async () => ({
        id: "queue-1",
        traceId: "queued-trace",
        kind: "manual" as const,
        requestedBy: "10000000-0000-4000-8000-000000000010",
        leaseToken: "40000000-0000-4000-8000-000000000001",
        attempt: 1,
      })),
      complete: vi.fn(async (input) => {
        completed.push(input);
      }),
      run,
    })).resolves.toBe(1);

    expect(run).toHaveBeenCalledWith("manual", expect.anything(), {
      traceId: "queued-trace",
      requestedBy: "10000000-0000-4000-8000-000000000010",
    });
    expect(completed[0]).toMatchObject({
      id: "queue-1",
      leaseToken: "40000000-0000-4000-8000-000000000001",
      status: "done",
      syncRunId: "run-1",
    });
  });

  it("cancels before append or finalization when the advisory fence is lost", async () => {
    let checks = 0;
    const lostFence = {
      backendPid: 2,
      assertOwned: vi.fn(async () => {
        checks += 1;
        if (checks > 1) throw new AppError("E_SYNC_FENCE_LOST", 409);
      }),
    };
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
      locks: { withSyncLock: vi.fn(async (_id, action) => action(lostFence)) },
      cursors: { get: vi.fn(async () => ({})) },
      runs: {
        start: vi.fn(async () => ({ id: "run-1", traceId: "trace-1" })),
        finish: vi.fn(),
      },
      raw: { appendPage: vi.fn(), quarantinePage: vi.fn() },
      transport: {
        requestPage: vi.fn(async () => ({ id: 9001, subdomain: "555151" })),
      },
      tokens: {
        createProvider: vi.fn(() => ({ getAccessToken: vi.fn(async () => "test-token") })),
        refresh: vi.fn(),
      },
      reconciliation: { previousFullLeadCount: vi.fn(async () => null) },
    } as unknown as AmoSyncDependencies;

    await expect(
      createAmoSyncRunner(dependencies)("incremental", createClock()),
    ).rejects.toMatchObject({ code: "E_SYNC_FENCE_LOST" });

    expect(dependencies.raw.appendPage).not.toHaveBeenCalled();
    expect(dependencies.runs.finish).not.toHaveBeenCalled();
  });

  it("seals a count-drop run even when the critical alert sink fails", async () => {
    const finished: unknown[] = [];
    const leads = Array.from({ length: 90 }, (_, index) => ({
      id: index + 1,
      account_id: 9001,
      created_at: 1,
      updated_at: 1 + index,
    }));
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
      locks: { withSyncLock: vi.fn(async (_id, action) => action(testFence)) },
      cursors: { get: vi.fn(async () => ({})) },
      runs: {
        start: vi.fn(async () => ({ id: "run-1", traceId: "trace-1" })),
        finish: vi.fn(async (_runId, outcome) => {
          finished.push(outcome);
        }),
      },
      raw: { appendPage: vi.fn(), quarantinePage: vi.fn() },
      transport: {
        requestPage: vi.fn(async (request) => {
          if (request.url.includes("/account")) return { id: 9001, subdomain: "555151" };
          if (request.url.includes("/pipelines/77/statuses")) return { _embedded: { statuses: [] } };
          if (request.url.includes("/pipelines")) return { _embedded: { pipelines: [] } };
          if (request.url.includes("/users")) return { _embedded: { users: [] } };
          if (request.url.includes("/events")) return { _embedded: { events: [] } };
          return { _embedded: { leads } };
        }),
      },
      tokens: {
        createProvider: vi.fn(() => ({ getAccessToken: vi.fn(async () => "test-token") })),
        refresh: vi.fn(),
      },
      reconciliation: { previousFullLeadCount: vi.fn(async () => 100) },
      alerts: {
        critical: vi.fn(async () => {
          throw new Error("alert sink unavailable");
        }),
      },
    } as unknown as AmoSyncDependencies;

    await expect(
      createAmoSyncRunner(dependencies)("nightly_reconciliation", createClock()),
    ).resolves.toMatchObject({ status: "failed", runId: "run-1" });

    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      status: "failed",
      errorCode: "E_DATA_QUALITY_BLOCK",
      counts: { leadsRead: 90 },
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(finished[0])).toContain("critical alert delivery failed");
  });
});
