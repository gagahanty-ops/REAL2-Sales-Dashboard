import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeDbClient,
  createServiceWorkerDbClient,
  type Database,
} from "./client";
import {
  appendAmoApiAudit,
  appendRawPage,
  getRawChannelValues,
  quarantineRawPage,
} from "./raw-amo";
import { finishSyncRun, startSyncRun } from "./sync-runs";
import {
  createAdminDb,
  ensureRestrictedTestLogins,
  localServiceWorkerDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let workerDb: Database;
const receivedAt = new Date("2026-09-15T09:00:00.000Z");
const finishedAt = new Date("2026-09-15T09:01:00.000Z");
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

type Fixture = Readonly<{ connectionId: string; configId: string }>;

async function seedFixture(): Promise<Fixture> {
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head]);
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id,
      subdomain,
      base_url,
      access_token_ciphertext,
      refresh_token_ciphertext,
      token_expires_at,
      status,
      installed_by
    ) values (
      4242,
      '555151',
      'https://555151.amocrm.ru',
      ${Buffer.alloc(64)},
      ${Buffer.alloc(64)},
      '2030-01-01T00:00:00.000Z',
      'active',
      ${testUsers.admin.id}
    )
    returning id
  `;
  if (!connection) throw new Error("synthetic connection fixture is missing");

  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id,
      pipeline_id,
      pipeline_name,
      application_status_id,
      application_status_name,
      won_status_id,
      won_status_name,
      source_field_id,
      version,
      is_active,
      confirmed_by
    ) values (
      ${connection.id},
      10243278,
      'РЕАЛ ДВА',
      11,
      'Завершение (самовывоз или доставка)',
      99,
      'Успешно реализовано',
      77,
      1,
      true,
      ${testUsers.admin.id}
    )
    returning id
  `;
  if (!config) throw new Error("synthetic config fixture is missing");
  return { connectionId: connection.id, configId: config.id };
}

async function startFixtureRun(
  db: Database,
  fixture: Fixture,
  traceId: string,
) {
  return startSyncRun(db, {
    traceId,
    connectionId: fixture.connectionId,
    configId: fixture.configId,
    kind: "incremental",
    createdBy: testUsers.admin.id,
    startedAt: receivedAt,
  });
}

async function clearFixture(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeAll(async () => {
  await ensureRestrictedTestLogins(adminDb);
  workerDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 1 });
});

beforeEach(async () => {
  await clearFixture();
});

afterEach(async () => {
  await clearFixture();
});

afterAll(async () => {
  await closeDbClient(workerDb);
  await closeDbClient(adminDb);
});

describe("append-only raw amoCRM journal", () => {
  it("stores repeated objects and events once and makes raw rows immutable to the worker", async () => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-idempotent");
    const lead = {
      accountId: 4242,
      entityType: "lead" as const,
      externalId: 7001,
      sourceUpdatedAt: new Date("2026-09-15T08:59:00.000Z"),
      payload: {
        id: 7001,
        account_id: 4242,
        updated_at: 1_757_926_740,
        custom_fields_values: [
          { field_id: 77, values: [{ value: "Synthetic source" }] },
        ],
      },
      payloadSha256: hashA,
    };
    const event = {
      accountId: 4242,
      amoEventId: "01pz58t6p04ymgsgfbmfyfy1mf",
      amoLeadId: 7001,
      eventType: "lead_status_changed",
      eventAt: new Date("2026-09-15T08:59:30.000Z"),
      payload: {
        id: "01pz58t6p04ymgsgfbmfyfy1mf",
        account_id: 4242,
        entity_id: 7001,
        type: "lead_status_changed",
        created_at: 1_757_926_770,
      },
      payloadSha256: hashB,
    };

    await appendRawPage(workerDb, {
      syncRunId: run.id,
      stream: "leads",
      pageNumber: 1,
      itemCount: 2,
      payloadSha256: "c".repeat(64),
      objects: [lead, lead],
      events: [event, event],
      receivedAt,
    });
    await appendRawPage(workerDb, {
      syncRunId: run.id,
      stream: "leads",
      pageNumber: 1,
      itemCount: 2,
      payloadSha256: "c".repeat(64),
      objects: [lead],
      events: [event],
      receivedAt,
    });

    await expect(
      adminDb<{ objects: number; events: number; pages: number }[]>`
        select
          (select count(*)::integer from public.raw_amo_objects) as objects,
          (select count(*)::integer from public.raw_amo_events) as events,
          (select count(*)::integer from public.sync_pages) as pages
      `,
    ).resolves.toEqual([{ objects: 1, events: 1, pages: 1 }]);

    await expect(
      workerDb`
        update public.raw_amo_events
        set event_type = 'changed'
        where amo_event_id = '01pz58t6p04ymgsgfbmfyfy1mf'
      `,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      workerDb`
        delete from public.raw_amo_objects where external_id = 7001
      `,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects event hash conflicts on a fresh page and page conflicts independently", async () => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-conflict");
    const event = {
      accountId: 4242,
      amoEventId: "01pz58t6p04ymgsgfbmfyfy1mf",
      amoLeadId: 7001,
      eventType: "lead_status_changed",
      eventAt: receivedAt,
      payload: { id: "01pz58t6p04ymgsgfbmfyfy1mf", synthetic: "first" },
      payloadSha256: hashA,
    };

    await appendRawPage(workerDb, {
      syncRunId: run.id,
      stream: "events",
      pageNumber: 1,
      itemCount: 1,
      payloadSha256: hashA,
      objects: [],
      events: [event],
      receivedAt,
    });

    await expect(
      appendRawPage(workerDb, {
        syncRunId: run.id,
        stream: "events",
        pageNumber: 2,
        itemCount: 1,
        payloadSha256: hashB,
        objects: [],
        events: [{
          ...event,
          payload: { id: "01pz58t6p04ymgsgfbmfyfy1mf", synthetic: "changed" },
          payloadSha256: hashB,
        }],
        receivedAt,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });

    await expect(
      adminDb<{ events: number; pages: number }[]>`
        select
          (select count(*)::integer from public.raw_amo_events) as events,
          (select count(*)::integer from public.sync_pages) as pages
      `,
    ).resolves.toEqual([{ events: 1, pages: 1 }]);

    await expect(
      appendRawPage(workerDb, {
        syncRunId: run.id,
        stream: "events",
        pageNumber: 1,
        itemCount: 1,
        payloadSha256: hashB,
        objects: [],
        events: [],
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("deduplicates string event IDs across runs within an account, not across accounts", async () => {
    const fixture = await seedFixture();
    const first = await startFixtureRun(workerDb, fixture, "trace-event-account-1");
    const event = {
      accountId: 4242,
      amoEventId: "event:01/ABC.2",
      amoLeadId: 7001,
      eventType: "lead_status_changed",
      eventAt: receivedAt,
      payload: { id: "event:01/ABC.2", synthetic: true },
      payloadSha256: hashA,
    };
    await appendRawPage(workerDb, {
      syncRunId: first.id,
      stream: "events",
      pageNumber: 1,
      itemCount: 1,
      payloadSha256: hashA,
      objects: [],
      events: [event],
      receivedAt,
    });
    await finishSyncRun(workerDb, first.id, {
      status: "success",
      counts: { pagesRead: 1, leadsRead: 0, eventsRead: 1, usersRead: 0, retries: 0 },
      nextCursors: {},
    }, finishedAt);

    const second = await startFixtureRun(workerDb, fixture, "trace-event-account-2");
    await appendRawPage(workerDb, {
      syncRunId: second.id,
      stream: "events",
      pageNumber: 1,
      itemCount: 2,
      payloadSha256: hashB,
      objects: [],
      events: [event, { ...event, accountId: 4343 }],
      receivedAt: new Date("2026-09-15T09:02:00.000Z"),
    });

    await expect(
      adminDb<{ account_id: string; amo_event_id: string }[]>`
        select account_id, amo_event_id
        from public.raw_amo_events
        order by account_id
      `,
    ).resolves.toEqual([
      { account_id: "4242", amo_event_id: "event:01/ABC.2" },
      { account_id: "4343", amo_event_id: "event:01/ABC.2" },
    ]);
  });

  it("advances cursors only in the same successful finish transaction", async () => {
    const fixture = await seedFixture();
    const first = await startFixtureRun(workerDb, fixture, "trace-success");

    await finishSyncRun(
      workerDb,
      first.id,
      {
        status: "success",
        counts: { pagesRead: 3, leadsRead: 4, eventsRead: 5, usersRead: 6, retries: 1 },
        nextCursors: {
          events: {
            cursorTime: new Date("2026-09-15T08:50:00.000Z"),
            cursorExternalId: "event:01/ABC.2",
          },
          leads: {
            cursorTime: new Date("2026-09-15T08:50:00.000Z"),
            cursorExternalId: "7001",
          },
        },
      },
      finishedAt,
    );

    const partial = await startFixtureRun(workerDb, fixture, "trace-partial");
    await finishSyncRun(
      workerDb,
      partial.id,
      {
        status: "partial",
        counts: { pagesRead: 2, leadsRead: 3, eventsRead: 0, usersRead: 0, retries: 5 },
        errorCode: "E_AMO_UPSTREAM",
        safeError: "Upstream response was incomplete",
      },
      new Date("2026-09-15T09:02:00.000Z"),
    );

    const cursors = await adminDb<{
      stream: string;
      cursor_time: Date;
      cursor_external_id: string;
      last_successful_run_id: string;
    }[]>`
      select stream, cursor_time, cursor_external_id, last_successful_run_id
      from public.sync_cursors order by stream
    `;
    expect(cursors).toEqual([
      {
        stream: "events",
        cursor_time: new Date("2026-09-15T08:50:00.000Z"),
        cursor_external_id: "event:01/ABC.2",
        last_successful_run_id: first.id,
      },
      {
        stream: "leads",
        cursor_time: new Date("2026-09-15T08:50:00.000Z"),
        cursor_external_id: "7001",
        last_successful_run_id: first.id,
      },
    ]);
    await expect(
      adminDb<{ status: string; error_summary: string }[]>`
        select status, error_summary from public.sync_runs where id = ${partial.id}
      `,
    ).resolves.toEqual([
      { status: "partial", error_summary: "Upstream response was incomplete" },
    ]);
  });

  it("does not let the worker rewrite any run fields or advance cursors directly", async () => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-pinned");

    await expect(
      workerDb`
        update public.sync_runs
        set pages_read = 99
        where id = ${run.id}
      `,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      workerDb`
        insert into public.sync_cursors (
          connection_id, stream, cursor_external_id, last_successful_run_id
        ) values (${fixture.connectionId}, 'events', '01pz-direct', ${run.id})
      `,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      workerDb`
        insert into public.sync_runs (
          trace_id, connection_id, config_id, kind, status, finished_at,
          pages_read
        ) values (
          'trace-forged-terminal', ${fixture.connectionId}, ${fixture.configId},
          'incremental', 'success', ${finishedAt}, 99
        )
      `,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      adminDb<{ trace_id: string }[]>`
        select trace_id from public.sync_runs where id = ${run.id}
      `,
    ).resolves.toEqual([{ trace_id: "trace-pinned" }]);
  });

  it.each(["", 9001, "x".repeat(129)])("rolls back a direct atomic finish for invalid cursor ID %s", async (invalidId) => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-invalid-cursor");

    await expect(
      workerDb`
        select app.finish_sync_run(
          ${run.id}::uuid,
          'success'::public.sync_status,
          ${finishedAt},
          1, 1, 1, 1, 0,
          null, null, null, null,
          ${workerDb.json({ events: { cursor_time: null, cursor_external_id: invalidId } })}
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });

    await expect(
      adminDb<{ status: string; pages_read: number; cursors: number }[]>`
        select status, pages_read,
          (select count(*)::integer from public.sync_cursors) as cursors
        from public.sync_runs
        where id = ${run.id}
      `,
    ).resolves.toEqual([{ status: "running", pages_read: 0, cursors: 0 }]);
  });

  it.each(["success", "partial", "failed"] as const)("seals all journal writes after a run becomes %s", async (status) => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-terminal-seal");
    await finishSyncRun(workerDb, run.id, {
      status,
      counts: { pagesRead: 0, leadsRead: 0, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: {},
      safeError: "Synthetic terminal outcome",
    }, finishedAt);

    await expect(workerDb`
      update public.sync_runs set status = 'failed', pages_read = 99 where id = ${run.id}
    `).rejects.toMatchObject({ code: "42501" });
    await expect(workerDb`
      update public.sync_cursors set cursor_external_id = 'forged'
      where connection_id = ${fixture.connectionId}
    `).rejects.toMatchObject({ code: "42501" });
    await expect(finishSyncRun(workerDb, run.id, {
      status: "success",
      counts: { pagesRead: 99, leadsRead: 0, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: { events: { cursorTime: receivedAt, cursorExternalId: "forged" } },
    })).rejects.toMatchObject({ code: "E_CONFLICT" });
    await expect(adminDb<{ status: string; pages_read: number; cursors: number }[]>`
      select status, pages_read,
        (select count(*)::integer from public.sync_cursors) as cursors
      from public.sync_runs where id = ${run.id}
    `).resolves.toEqual([{ status, pages_read: 0, cursors: 0 }]);

    await expect(
      appendRawPage(workerDb, {
        syncRunId: run.id,
        stream: "leads",
        pageNumber: 1,
        itemCount: 0,
        payloadSha256: hashA,
        objects: [],
        events: [],
        receivedAt,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      workerDb`
        insert into public.raw_amo_objects (
          sync_run_id, account_id, entity_type, external_id,
          payload, payload_sha256
        ) values (
          ${run.id}, 4242, 'lead', 7001,
          ${workerDb.json({ id: 7001, synthetic: true })}, ${hashA}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      workerDb`
        insert into public.raw_amo_events (
          sync_run_id, account_id, amo_event_id, amo_lead_id,
          event_type, event_at, payload, payload_sha256
        ) values (
          ${run.id}, 4242, '01pz-terminal', 7001,
          'lead_status_changed', ${receivedAt},
          ${workerDb.json({ id: "01pz-terminal", synthetic: true })}, ${hashB}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      workerDb`
        insert into public.raw_amo_quarantine (
          sync_run_id, stream, page_number, reason_code,
          payload, payload_sha256
        ) values (
          ${run.id}, 'leads', 2, 'E_AMO_SCHEMA',
          ${workerDb.json({ synthetic: true })}, ${hashB}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      quarantineRawPage(workerDb, {
        syncRunId: run.id,
        stream: "leads",
        pageNumber: 2,
        reasonCode: "E_AMO_SCHEMA",
        payload: { synthetic: true },
        payloadSha256: hashB,
        receivedAt,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      appendAmoApiAudit(workerDb, {
        syncRunId: run.id,
        traceId: "trace-terminal-audit",
        method: "GET",
        normalizedPath: "/api/v4/leads",
        responseStatus: 200,
        durationMs: 1,
        attempt: 1,
        result: "success",
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["append", "finish"] as const)("serializes concurrent append/finalize when %s acquires the run lock first", async (firstOperation) => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-concurrent-seal");
    const concurrentDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 1 });
    const [connection] = await concurrentDb<{ pid: number }[]>`select pg_backend_pid() as pid`;
    if (!connection) throw new Error("synthetic concurrent connection is missing");
    const { pid } = connection;
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const finish = (db: Database) => finishSyncRun(db, run.id, {
      status: "success",
      counts: { pagesRead: 0, leadsRead: 0, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: {},
    });
    const append = (db: Database) => appendAmoApiAudit(db, {
      syncRunId: run.id,
      traceId: "trace-concurrent-audit",
      method: "GET",
      normalizedPath: "/api/v4/leads",
      durationMs: 1,
      attempt: 1,
      result: "success",
    });
    const first = workerDb.begin(async (transaction) => {
      const tx = transaction as unknown as Database;
      await (firstOperation === "append" ? append(tx) : finish(tx));
      ready();
      await held;
    });
    let second: Promise<unknown> | undefined;
    try {
      await locked;
      second = (firstOperation === "append" ? finish(concurrentDb) : append(concurrentDb))
        .then(() => ({ success: true }), (error: unknown) => error);
      await expect.poll(async () => {
        const [row] = await adminDb<{ blocked: boolean }[]>`
          select cardinality(pg_blocking_pids(${pid})) > 0 as blocked
        `;
        return row?.blocked;
      }, { timeout: 3000 }).toBe(true);
      release();
      await first;
      expect(await second).toMatchObject(
        firstOperation === "append" ? { success: true } : { code: "23514" },
      );
    } finally {
      release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      await closeDbClient(concurrentDb);
    }
  });

  it("quarantines malformed payloads idempotently without changing the cursor", async () => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-quarantine");
    const input = {
      syncRunId: run.id,
      stream: "leads" as const,
      pageNumber: 3,
      reasonCode: "E_AMO_SCHEMA",
      payload: { unexpected: "synthetic malformed value" },
      payloadSha256: hashA,
      receivedAt,
    };

    await quarantineRawPage(workerDb, input);
    await quarantineRawPage(workerDb, input);

    await expect(
      adminDb<{ quarantine: number; cursors: number }[]>`
        select
          (select count(*)::integer from public.raw_amo_quarantine) as quarantine,
          (select count(*)::integer from public.sync_cursors) as cursors
      `,
    ).resolves.toEqual([{ quarantine: 1, cursors: 0 }]);
  });

  it("persists only the safe audit shape and canonicalizes dynamic or unsafe paths", async () => {
    const fixture = await seedFixture();
    const run = await startFixtureRun(workerDb, fixture, "trace-audit-run");

    await appendAmoApiAudit(workerDb, {
      syncRunId: run.id,
      traceId: "trace-audit-entry",
      method: "GET",
      normalizedPath: "/api/v4/leads",
      responseStatus: 200,
      durationMs: 17,
      attempt: 1,
      result: "success",
    });
    await appendAmoApiAudit(workerDb, {
      syncRunId: run.id,
      traceId: "trace-dynamic-entry",
      method: "GET",
      normalizedPath: "/api/v4/leads/7001",
      responseStatus: 200,
      durationMs: 2,
      attempt: 1,
      result: "success",
    });

    const [row] = await adminDb<Record<string, unknown>[]>`
      select * from public.amo_api_audit order by trace_id
    `;
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "attempt",
      "created_at",
      "duration_ms",
      "id",
      "method",
      "normalized_path",
      "response_status",
      "result",
      "sync_run_id",
      "trace_id",
    ]);
    expect(JSON.stringify(row)).not.toContain("token");
    expect(JSON.stringify(row)).not.toContain("page=2");

    await workerDb`
        insert into public.amo_api_audit (
          sync_run_id, trace_id, method, normalized_path,
          response_status, duration_ms, attempt, result
        ) values (
          ${run.id}, 'trace-unsafe', 'GET', '/api/v4/leads/Maria@example.com?token=secret',
          200, 1, 1, 'success'
        )
      `;

    await expect(
      adminDb<{ trace_id: string; normalized_path: string }[]>`
        select trace_id, normalized_path
        from public.amo_api_audit
        order by trace_id
      `,
    ).resolves.toEqual([
      { trace_id: "trace-audit-entry", normalized_path: "/api/v4/leads" },
      { trace_id: "trace-dynamic-entry", normalized_path: "/api/v4/leads/:id" },
      { trace_id: "trace-unsafe", normalized_path: "/denied" },
    ]);
    const auditJson = JSON.stringify(
      await adminDb`select normalized_path from public.amo_api_audit`,
    );
    expect(auditJson).not.toMatch(/Maria|token|secret|7001/);
  });

  it("counts exact source-field values from each lead's latest successful raw snapshot", async () => {
    const fixture = await seedFixture();
    const first = await startFixtureRun(workerDb, fixture, "trace-values-1");
    await appendRawPage(workerDb, {
      syncRunId: first.id,
      stream: "leads",
      pageNumber: 1,
      itemCount: 3,
      payloadSha256: hashA,
      objects: [
        {
          accountId: 4242,
          entityType: "lead",
          externalId: 7001,
          sourceUpdatedAt: new Date("2026-09-15T08:00:00.000Z"),
          payload: { id: 7001, custom_fields_values: [{ field_id: 77, values: [{ value: "WhatsApp" }] }] },
          payloadSha256: "1".repeat(64),
        },
        {
          accountId: 4242,
          entityType: "lead",
          externalId: 7002,
          sourceUpdatedAt: new Date("2026-09-15T08:00:00.000Z"),
          payload: { id: 7002, custom_fields_values: [{ field_id: 77, values: [{ value: "Avito" }] }] },
          payloadSha256: "2".repeat(64),
        },
        {
          accountId: 4242,
          entityType: "lead",
          externalId: 7003,
          sourceUpdatedAt: new Date("2026-09-15T08:00:00.000Z"),
          payload: { id: 7003, custom_fields_values: [{ field_id: 77, values: [{ value: " Avito " }] }] },
          payloadSha256: "4".repeat(64),
        },
      ],
      events: [],
      receivedAt,
    });
    await finishSyncRun(workerDb, first.id, {
      status: "success",
      counts: { pagesRead: 1, leadsRead: 3, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: {},
    }, finishedAt);

    const second = await startFixtureRun(workerDb, fixture, "trace-values-2");
    await appendRawPage(workerDb, {
      syncRunId: second.id,
      stream: "leads",
      pageNumber: 1,
      itemCount: 1,
      payloadSha256: hashB,
      objects: [{
        accountId: 4242,
        entityType: "lead",
        externalId: 7001,
        sourceUpdatedAt: new Date("2026-09-15T08:30:00.000Z"),
        payload: { id: 7001, custom_fields_values: [{ field_id: 77, values: [{ value: "Avito" }] }] },
        payloadSha256: "3".repeat(64),
      }],
      events: [],
      receivedAt: new Date("2026-09-15T09:03:00.000Z"),
    });
    await finishSyncRun(workerDb, second.id, {
      status: "success",
      counts: { pagesRead: 1, leadsRead: 1, eventsRead: 0, usersRead: 0, retries: 0 },
      nextCursors: {},
    }, new Date("2026-09-15T09:04:00.000Z"));

    await expect(
      getRawChannelValues(adminDb, {
        connectionId: fixture.connectionId,
        sourceFieldId: 77,
      }),
    ).resolves.toEqual([
      { value: "Avito", count: 2 },
      { value: " Avito ", count: 1 },
    ]);
  });
});
