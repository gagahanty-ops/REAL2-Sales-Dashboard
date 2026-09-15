import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDbClient,
  createRetentionWorkerDbClient,
  createServiceWorkerDbClient,
} from "./client";
import { appendRawPage, quarantineRawPage } from "./raw-amo";
import {
  deleteProvenRawBefore,
  failStaleSyncRuns,
  getPreviousFullLeadCount,
  getSyncCursors,
  recordRawRetentionProofs,
  withSyncAdvisoryLock,
} from "./sync-operations";
import { finishSyncRun, startSyncRun } from "./sync-runs";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
const workerOne = createServiceWorkerDbClient(localDatabaseUrl, { max: 2 });
const workerTwo = createServiceWorkerDbClient(localDatabaseUrl, { max: 2 });
const retentionDb = createRetentionWorkerDbClient(localDatabaseUrl, { max: 1 });
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
    "truncate table public.raw_retention_proofs, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

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

  it("retention deletes only hash-matched proven rows and preserves proof history", async () => {
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
    const rawRows = await adminDb<{ source_table: string; source_id: string; payload_sha256: string }[]>`
      select 'raw_amo_objects' as source_table, id as source_id, payload_sha256 from public.raw_amo_objects
      union all
      select 'raw_amo_events', id, payload_sha256 from public.raw_amo_events
      union all
      select 'raw_amo_quarantine', id, payload_sha256 from public.raw_amo_quarantine
      order by source_table
    `;
    await recordRawRetentionProofs(workerOne, rawRows.map((row, index) => ({
      sourceTable: row.source_table as "raw_amo_objects" | "raw_amo_events" | "raw_amo_quarantine",
      sourceId: row.source_id,
      payloadSha256: row.payload_sha256,
      normalizedEntityType: "lead_history",
      normalizedEntityId: `synthetic:${index + 1}`,
      provedAt: now,
    })));

    await expect(deleteProvenRawBefore(retentionDb, new Date("2026-06-17T09:00:00.000Z"))).resolves.toEqual({
      objectsDeleted: 1,
      eventsDeleted: 1,
      quarantineDeleted: 1,
      hashesPreserved: 3,
      normalizedRowsVerified: 3,
    });
    const [remaining] = await adminDb<{ raw_count: number; proof_count: number }[]>`
      select
        ((select count(*) from public.raw_amo_objects) +
         (select count(*) from public.raw_amo_events) +
         (select count(*) from public.raw_amo_quarantine))::integer as raw_count,
        (select count(*)::integer from public.raw_retention_proofs) as proof_count
    `;
    expect(remaining).toEqual({ raw_count: 0, proof_count: 3 });
    await expect(workerOne`delete from public.raw_amo_objects`).rejects.toMatchObject({ code: "42501" });
  });
});
