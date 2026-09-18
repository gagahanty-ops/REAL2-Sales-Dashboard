import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeDbClient,
  createRetentionWorkerDbClient,
  createServiceWorkerDbClient,
  type Database,
} from "./client";
import { appendRawPage, quarantineRawPage } from "./raw-amo";
import {
  claimNextSyncWork,
  completeSyncWork,
  deleteProvenRawBefore,
  enqueueSyncWork,
  failStaleSyncRuns,
  getPreviousFullLeadCount,
  getSyncCursors,
  isSyncAdvisoryLockBusy,
  withSyncAdvisoryLock,
} from "./sync-operations";
import { finishSyncRun, startSyncRun } from "./sync-runs";
import {
  createAdminDb,
  ensureRestrictedTestLogins,
  localRetentionWorkerDatabaseUrl,
  localServiceWorkerDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let workerOne: Database;
let workerTwo: Database;
let retentionDb: Database;
const oldAt = new Date("2026-01-01T00:00:00.000Z");
const now = new Date("2026-09-15T09:00:00.000Z");

type Fixture = Readonly<{ connectionId: string; configId: string }>;

async function seedFixture(): Promise<Fixture> {
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      9001, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
      ${Buffer.alloc(64)}, '2030-01-01T00:00:00Z', 'active', ${testUsers.admin.id}
    ) returning id
  `;
  if (!connection) throw new Error("missing synthetic connection");
  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id, pipeline_id, pipeline_name, application_status_id,
      application_status_name, won_status_id, won_status_name, version,
      is_active, confirmed_by
    ) values (
      ${connection.id}, 77, 'Synthetic', 771, 'Application', 772, 'Won', 1,
      true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing synthetic config");
  return { connectionId: connection.id, configId: config.id };
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeAll(async () => {
  await ensureRestrictedTestLogins(adminDb);
  workerOne = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 2 });
  workerTwo = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 2 });
  retentionDb = createRetentionWorkerDbClient(localRetentionWorkerDatabaseUrl, { max: 1 });
});

beforeEach(clearFixtures);
afterEach(clearFixtures);
afterAll(async () => {
  await Promise.all([
    closeDbClient(retentionDb),
    closeDbClient(workerTwo),
    closeDbClient(workerOne),
    closeDbClient(adminDb),
  ]);
});

describe("sync operational boundaries", () => {
  it("allows only one session advisory-lock owner", async () => {
    const fixture = await seedFixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withSyncAdvisoryLock(workerOne, fixture.connectionId, async () => {
      entered();
      await held;
      return "first";
    });
    await acquired;

    await expect(
      withSyncAdvisoryLock(workerTwo, fixture.connectionId, async () => "second"),
    ).rejects.toMatchObject({ code: "E_SYNC_LOCKED" });
    release();
    await expect(first).resolves.toBe("first");
    await expect(
      withSyncAdvisoryLock(workerTwo, fixture.connectionId, async () => "after"),
    ).resolves.toBe("after");
  });

  it("preflights the same advisory lock without taking ownership away from the runner", async () => {
    const fixture = await seedFixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withSyncAdvisoryLock(workerOne, fixture.connectionId, async () => {
      entered();
      await held;
    });
    await acquired;

    await expect(isSyncAdvisoryLockBusy(workerTwo, fixture.connectionId)).resolves.toBe(true);
    release();
    await first;
    await expect(isSyncAdvisoryLockBusy(workerTwo, fixture.connectionId)).resolves.toBe(false);
  });

  it("releases the advisory lock after nested failures", async () => {
    const fixture = await seedFixture();

    await expect(
      withSyncAdvisoryLock(workerOne, fixture.connectionId, async () => {
        throw Object.assign(new Error("nested failure"), { code: "E_INTERNAL" });
      }),
    ).rejects.toMatchObject({ code: "E_INTERNAL" });
    await expect(
      withSyncAdvisoryLock(workerTwo, fixture.connectionId, async () => "after-throw"),
    ).resolves.toBe("after-throw");
  });

  it("fences an actually terminated advisory-lock session before work continues", async () => {
    const fixture = await seedFixture();
    const victimDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 1 });
    let allowFenceCheck!: () => void;
    const terminated = new Promise<void>((resolve) => {
      allowFenceCheck = resolve;
    });
    let publishBackendPid!: (pid: number) => void;
    const backendPid = new Promise<number>((resolve) => {
      publishBackendPid = resolve;
    });

    try {
      const runner = withSyncAdvisoryLock(victimDb, fixture.connectionId, async (fence) => {
        publishBackendPid(fence.backendPid);
        await terminated;
        await expect(fence.assertOwned()).rejects.toMatchObject({ code: "E_SYNC_FENCE_LOST" });
        return "fenced";
      });

      const pid = await backendPid;
      const [row] = await adminDb<{ terminated: boolean }[]>`
        select pg_terminate_backend(${pid}) as terminated
      `;
      expect(row?.terminated).toBe(true);
      allowFenceCheck();

      await expect(runner).resolves.toBe("fenced");
      await expect(isSyncAdvisoryLockBusy(workerTwo, fixture.connectionId)).resolves.toBe(false);
      await expect(
        withSyncAdvisoryLock(workerTwo, fixture.connectionId, async () => "after-terminate"),
      ).resolves.toBe("after-terminate");
    } finally {
      await closeDbClient(victimDb);
    }
  }, 15_000);

  it("claims queued sync work once with skip locked and recovers an expired lease", async () => {
    await seedFixture();
    const queued = await enqueueSyncWork(adminDb, {
      traceId: "manual-trace-1",
      kind: "manual",
      requestedBy: testUsers.admin.id,
    });
    await enqueueSyncWork(adminDb, {
      traceId: "manual-trace-2",
      kind: "manual",
      requestedBy: testUsers.admin.id,
    });
    const claimedAt = new Date("2026-09-15T09:00:00.000Z");
    const [first, second] = await Promise.all([
      claimNextSyncWork(workerOne, { now: claimedAt, leaseMs: 60_000 }),
      claimNextSyncWork(workerTwo, { now: claimedAt, leaseMs: 60_000 }),
    ]);

    expect([first?.traceId, second?.traceId].sort()).toEqual([
      "manual-trace-1",
      "manual-trace-2",
    ]);

    const stillLeased = await claimNextSyncWork(workerTwo, {
      now: new Date("2026-09-15T09:00:30.000Z"),
      leaseMs: 60_000,
    });
    expect(stillLeased).toBeNull();

    const recovered = await claimNextSyncWork(workerTwo, {
      now: new Date("2026-09-15T09:01:01.000Z"),
      leaseMs: 60_000,
    });
    expect(recovered).toMatchObject({
      id: queued.id,
      traceId: "manual-trace-1",
      requestedBy: testUsers.admin.id,
      attempt: 2,
    });
    expect(recovered?.leaseToken).not.toBe(first?.leaseToken);

    await expect(
      completeSyncWork(workerOne, {
        id: queued.id,
        leaseToken: first?.leaseToken ?? "00000000-0000-4000-8000-000000000000",
        status: "done",
        completedAt: new Date("2026-09-15T09:01:02.000Z"),
        syncRunId: "30000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    await completeSyncWork(workerTwo, {
      id: queued.id,
      leaseToken: recovered?.leaseToken ?? "00000000-0000-4000-8000-000000000000",
      status: "done",
      completedAt: new Date("2026-09-15T09:01:03.000Z"),
      syncRunId: "30000000-0000-4000-8000-000000000002",
    });
    for (const claim of [first, second]) {
      if (!claim || claim.id === queued.id) continue;
      await completeSyncWork(workerOne, {
        id: claim.id,
        leaseToken: claim.leaseToken,
        status: "done",
        completedAt: new Date("2026-09-15T09:01:04.000Z"),
        syncRunId: "30000000-0000-4000-8000-000000000003",
      });
    }
    await expect(claimNextSyncWork(workerOne, {
      now: new Date("2026-09-15T09:02:04.000Z"),
      leaseMs: 60_000,
    })).resolves.toBeNull();
  });

  it("sweeps expired max-attempt queue work to failed before claiming", async () => {
    await seedFixture();
    await adminDb`
      insert into public.sync_work_queue (
        trace_id, kind, requested_by, status, attempt_count,
        claimed_at, lease_token, lease_expires_at
      ) values (
        'expired-running', 'manual', ${testUsers.admin.id}, 'running', 3,
        ${new Date("2026-09-15T08:00:00.000Z")},
        '40000000-0000-4000-8000-000000000001',
        ${new Date("2026-09-15T08:20:00.000Z")}
      )
    `;
    await adminDb`
      insert into public.sync_work_queue (
        trace_id, kind, requested_by, status, attempt_count
      ) values (
        'queued-exhausted', 'manual', ${testUsers.admin.id}, 'queued', 3
      )
    `;

    await expect(claimNextSyncWork(workerOne, {
      now,
      leaseMs: 60_000,
      maxAttempts: 3,
    })).resolves.toBeNull();
    await expect(
      adminDb<{
        trace_id: string;
        status: string;
        completed_at: Date | null;
        last_error_code: string | null;
        last_error_summary: string | null;
      }[]>`
        select trace_id, status, completed_at, last_error_code, last_error_summary
        from public.sync_work_queue
        order by trace_id
      `,
    ).resolves.toEqual([
      {
        trace_id: "expired-running",
        status: "failed",
        completed_at: now,
        last_error_code: "E_SYNC_QUEUE_EXHAUSTED",
        last_error_summary: "Queued synchronization exceeded retry attempts",
      },
      {
        trace_id: "queued-exhausted",
        status: "failed",
        completed_at: now,
        last_error_code: "E_SYNC_QUEUE_EXHAUSTED",
        last_error_summary: "Queued synchronization exceeded retry attempts",
      },
    ]);
  });

  it("reclaims crashed queue work without reusing the previous run trace", async () => {
    const fixture = await seedFixture();
    const queued = await enqueueSyncWork(adminDb, {
      traceId: "stable-queue-correlation",
      kind: "manual",
      requestedBy: testUsers.admin.id,
    });
    const first = await claimNextSyncWork(workerOne, {
      now,
      leaseMs: 60_000,
      maxAttempts: 3,
    });
    expect(first).toMatchObject({
      id: queued.id,
      traceId: "stable-queue-correlation",
      attempt: 1,
    });
    if (!first) throw new Error("first claim missing");
    const firstRun = await startSyncRun(workerOne, {
      traceId: "attempt-trace-1",
      correlationTraceId: first.traceId,
      connectionId: fixture.connectionId,
      configId: fixture.configId,
      kind: "manual",
      createdBy: first.requestedBy,
      startedAt: now,
    });

    const recovered = await claimNextSyncWork(workerTwo, {
      now: new Date("2026-09-15T09:01:01.000Z"),
      leaseMs: 60_000,
      maxAttempts: 3,
    });
    expect(recovered).toMatchObject({
      id: queued.id,
      traceId: "stable-queue-correlation",
      requestedBy: testUsers.admin.id,
      attempt: 2,
    });
    if (!recovered) throw new Error("recovered claim missing");
    const secondRun = await startSyncRun(workerTwo, {
      traceId: "attempt-trace-2",
      correlationTraceId: recovered.traceId,
      connectionId: fixture.connectionId,
      configId: fixture.configId,
      kind: "manual",
      createdBy: recovered.requestedBy,
      startedAt: new Date("2026-09-15T09:01:01.000Z"),
    });

    expect(secondRun.traceId).not.toBe(firstRun.traceId);
    await expect(
      adminDb<{ trace_id: string; correlation_trace_id: string | null; created_by: string | null }[]>`
        select trace_id, correlation_trace_id, created_by
        from public.sync_runs
        where id in (${firstRun.id}, ${secondRun.id})
        order by trace_id
      `,
    ).resolves.toEqual([
      {
        trace_id: "attempt-trace-1",
        correlation_trace_id: "stable-queue-correlation",
        created_by: testUsers.admin.id,
      },
      {
        trace_id: "attempt-trace-2",
        correlation_trace_id: "stable-queue-correlation",
        created_by: testUsers.admin.id,
      },
    ]);
  });

  it("returns cursors and the previous successful full lead count", async () => {
    const fixture = await seedFixture();
    const run = await startSyncRun(workerOne, {
      traceId: "full-count",
      connectionId: fixture.connectionId,
      configId: fixture.configId,
      kind: "nightly_reconciliation",
      startedAt: oldAt,
    });
    await finishSyncRun(workerOne, run.id, {
      status: "success",
      counts: { pagesRead: 1, leadsRead: 100, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: {
        leads: { cursorTime: oldAt, cursorExternalId: "lead-100" },
      },
    }, now);

    await expect(getPreviousFullLeadCount(workerOne, fixture.connectionId)).resolves.toBe(100);
    await expect(getSyncCursors(workerOne, fixture.connectionId)).resolves.toMatchObject({
      leads: { cursorTime: oldAt, cursorExternalId: "lead-100" },
    });
  });

  it("watchdog seals stale runs and the journal rejects later appends", async () => {
    const fixture = await seedFixture();
    const run = await startSyncRun(workerOne, {
      traceId: "stale-run",
      connectionId: fixture.connectionId,
      configId: fixture.configId,
      kind: "incremental",
      startedAt: oldAt,
    });

    await expect(
      failStaleSyncRuns(workerOne, new Date("2026-09-15T08:40:00.000Z"), now),
    ).resolves.toEqual([run.id]);
    await expect(
      appendRawPage(workerOne, {
        syncRunId: run.id,
        stream: "leads",
        pageNumber: 1,
        itemCount: 0,
        payloadSha256: "a".repeat(64),
        objects: [],
        events: [],
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("retention fails closed while no concrete normalized history relation exists", async () => {
    const fixture = await seedFixture();
    const run = await startSyncRun(workerOne, {
      traceId: "retention-run",
      connectionId: fixture.connectionId,
      configId: fixture.configId,
      kind: "initial_backfill",
      startedAt: oldAt,
    });
    const objectHash = "a".repeat(64);
    const eventHash = "b".repeat(64);
    const quarantineHash = "c".repeat(64);
    await appendRawPage(workerOne, {
      syncRunId: run.id,
      stream: "leads",
      pageNumber: 1,
      itemCount: 2,
      payloadSha256: "d".repeat(64),
      objects: [{
        accountId: 9001,
        entityType: "lead",
        externalId: 1,
        payload: { id: 1 },
        payloadSha256: objectHash,
      }],
      events: [{
        accountId: 9001,
        amoEventId: "event:1",
        amoLeadId: 1,
        eventType: "lead_status_changed",
        eventAt: oldAt,
        payload: { id: "event:1" },
        payloadSha256: eventHash,
      }],
      receivedAt: oldAt,
    });
    await quarantineRawPage(workerOne, {
      syncRunId: run.id,
      stream: "events",
      pageNumber: 1,
      reasonCode: "E_SCHEMA_INVALID",
      payload: { synthetic: true },
      payloadSha256: quarantineHash,
      receivedAt: oldAt,
    });
    await expect(deleteProvenRawBefore(retentionDb, new Date("2026-06-17T09:00:00.000Z"))).resolves.toEqual({
      objectsDeleted: 0,
      eventsDeleted: 0,
      quarantineDeleted: 0,
      hashesPreserved: 0,
      normalizedRowsVerified: 0,
    });
    const [remaining] = await adminDb<{ raw_count: number; proof_count: number }[]>`
      select
        ((select count(*) from public.raw_amo_objects) +
         (select count(*) from public.raw_amo_events) +
         (select count(*) from public.raw_amo_quarantine))::integer as raw_count,
        (select count(*)::integer from public.raw_retention_proofs) as proof_count
    `;
    expect(remaining).toEqual({ raw_count: 3, proof_count: 0 });
    await expect(workerOne`delete from public.raw_amo_objects`).rejects.toMatchObject({ code: "42501" });
  });
});
