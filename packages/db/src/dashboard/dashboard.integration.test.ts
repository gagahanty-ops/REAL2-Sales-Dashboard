import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDbClient, createDbClient, type Database } from "../client";
import { approveSnapshot, createMetricSnapshot, type MetricCellInput } from "../snapshots";
import { setSalesPlanTarget } from "../sales-plans";
import { getChannelMetrics } from "./channels";
import { getFunnelMetrics } from "./funnel";
import { getManagerMetrics } from "./managers";
import { getOverview } from "./overview";
import { withCurrentSnapshot } from "./with-snapshot";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let db: Database;

const ACCOUNT_ID = 9001;
const PIPELINE_ID = 77;
const OPEN_STATUS_ID = 770;
const APPLICATION_STATUS_ID = 771;
const WON_STATUS_ID = 772;
const MANAGER_ONE = 601;
const MANAGER_TWO = 602;
const NOW = new Date("2026-09-19T12:00:00.000Z");

const departmentScope = {
  kind: "department" as const,
  amoUserIds: [] as readonly number[],
  includeUnassigned: false,
};
const filters = {
  from: "2026-09-05",
  to: "2026-09-06",
  channels: [] as readonly never[],
  managerIds: [] as readonly number[],
  includeUnassigned: false,
  allManagers: true,
  compare: true,
};

type Seeded = Readonly<{ connectionId: string; configId: string; syncRunId: string }>;

async function seedAccount(finishedAt: string): Promise<Seeded> {
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      ${ACCOUNT_ID}, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
      ${Buffer.alloc(64)}, '2030-01-01T00:00:00Z', 'active', ${testUsers.admin.id}
    ) returning id
  `;
  if (!connection) throw new Error("missing connection");
  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id, pipeline_id, pipeline_name, application_status_id,
      application_status_name, won_status_id, won_status_name, version,
      is_active, confirmed_by
    ) values (
      ${connection.id}, ${PIPELINE_ID}, 'Synthetic', ${APPLICATION_STATUS_ID},
      'Заявка', ${WON_STATUS_ID}, 'Успешно реализовано', 1, true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing config");
  const [run] = await adminDb<{ id: string }[]>`
    insert into public.sync_runs (
      trace_id, connection_id, config_id, kind, status, started_at, finished_at,
      source_max_updated_at
    ) values (
      ${`dashboard-${Date.now()}-${Math.random()}`}, ${connection.id}, ${config.id},
      'incremental', 'success', '2026-09-19T11:00:00Z', ${finishedAt}, ${finishedAt}
    ) returning id
  `;
  if (!run) throw new Error("missing run");
  for (const [amoUserId, name] of [
    [MANAGER_ONE, "Менеджер один"],
    [MANAGER_TWO, "Менеджер два"],
  ] as const) {
    await adminDb`
      insert into public.amo_users (account_id, amo_user_id, name, email, is_active)
      values (${ACCOUNT_ID}, ${amoUserId}, ${name}, null, true)
      on conflict (account_id, amo_user_id) do nothing
    `;
  }
  return { connectionId: connection.id, configId: config.id, syncRunId: run.id };
}

/**
 * Two days, two managers and two channels, with every aggregate row the
 * validation requires.
 */
function cellsFor(revenueOfManagerOne: string): readonly MetricCellInput[] {
  const build = (
    reportDate: string,
    managerKey: string,
    channelKey: string,
    leadsCreated: number,
    applications: number,
    payments: number,
    revenue: string,
  ): MetricCellInput => ({
    reportDate,
    managerKey,
    channelKey,
    leadsCreated,
    applications,
    payments,
    revenue,
  });
  return [
    build("2026-09-05", "all", "all", 3, 2, 1, revenueOfManagerOne),
    build("2026-09-05", String(MANAGER_ONE), "all", 2, 1, 1, revenueOfManagerOne),
    build("2026-09-05", String(MANAGER_TWO), "all", 1, 1, 0, "0.00"),
    build("2026-09-05", "all", "site", 2, 1, 1, revenueOfManagerOne),
    build("2026-09-05", "all", "avito", 1, 1, 0, "0.00"),
    build("2026-09-05", String(MANAGER_ONE), "site", 2, 1, 1, revenueOfManagerOne),
    build("2026-09-05", String(MANAGER_TWO), "avito", 1, 1, 0, "0.00"),
    build("2026-09-06", "all", "all", 1, 0, 0, "0.00"),
    build("2026-09-06", String(MANAGER_TWO), "all", 1, 0, 0, "0.00"),
    build("2026-09-06", "all", "site", 1, 0, 0, "0.00"),
    build("2026-09-06", String(MANAGER_TWO), "site", 1, 0, 0, "0.00"),
  ];
}

async function seedSnapshot(
  seeded: Seeded,
  revenue: string,
  checksumSeed: string,
): Promise<Readonly<{ id: string; version: number }>> {
  const snapshot = await createMetricSnapshot(db, {
    syncRunId: seeded.syncRunId,
    configId: seeded.configId,
    sourceFreshAt: new Date("2026-09-19T11:50:00Z"),
    checksum: checksumSeed.repeat(64).slice(0, 64),
    qualitySummary: { unknown_channel_count: 1 },
    cells: cellsFor(revenue),
    // One paying lead so the snapshot's facts cross-foot with its cells.
    facts: [
      {
        accountId: ACCOUNT_ID,
        amoLeadId: 101,
        displayName: "Сделка #101",
        reportDate: "2026-09-05",
        managerKey: String(MANAGER_ONE),
        managerName: "Менеджер один",
        channelKey: "site",
        currentStatusId: WON_STATUS_ID,
        priceRub: revenue,
        applicationAt: new Date("2026-09-06T09:00:00Z"),
        wonAt: new Date("2026-09-07T09:00:00Z"),
        currentlyWon: true,
        amoUrl: "https://555151.amocrm.ru/leads/detail/101",
        qualityCodes: [],
      },
    ],
    stageRows: [
      {
        statusId: OPEN_STATUS_ID,
        statusName: "Первичный контакт",
        managerKey: String(MANAGER_ONE),
        openCount: 2,
        openAmount: "1000.00",
        medianAgeSeconds: 600,
        averageAgeSeconds: 900,
      },
      {
        statusId: OPEN_STATUS_ID,
        statusName: "Первичный контакт",
        managerKey: String(MANAGER_TWO),
        openCount: 1,
        openAmount: "500.00",
        medianAgeSeconds: 1_200,
        averageAgeSeconds: 1_200,
      },
    ],
  });
  return { id: snapshot.id, version: snapshot.version };
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeAll(() => {
  db = createDbClient(localDatabaseUrl, { max: 4 });
});
beforeEach(clearFixtures);
afterAll(async () => {
  await clearFixtures();
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

describe("dashboard reads one approved snapshot", () => {
  it("keeps one snapshot version even when the pointer moves during the request", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const first = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, first.id);

    const result = await withCurrentSnapshot(db, async (tx, snapshot) => {
      // A competing approval lands while this request is still reading.
      const [otherRun] = await adminDb<{ id: string }[]>`
        insert into public.sync_runs (
          trace_id, connection_id, config_id, kind, status, started_at, finished_at
        ) values (
          ${`dashboard-second-${Date.now()}`}, ${seeded.connectionId}, ${seeded.configId},
          'incremental', 'success', '2026-09-19T11:56:00Z', '2026-09-19T11:57:00Z'
        ) returning id
      `;
      if (!otherRun) throw new Error("missing second run");
      const second = await seedSnapshot(
        { ...seeded, syncRunId: otherRun.id },
        "2000.00",
        "b",
      );
      await approveSnapshot(db, second.id);
      return getOverview(tx, snapshot, { filters, scope: departmentScope, now: NOW });
    });

    expect(result.snapshot.version).toBe(first.version);
    expect(result.data.totals.revenueRub).toBe("1000.00");
  });

  it("reconciles overview totals with the manager and channel tables", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    const { data } = await withCurrentSnapshot(db, async (tx, meta) => ({
      overview: await getOverview(tx, meta, { filters, scope: departmentScope, now: NOW }),
      managers: await getManagerMetrics(tx, meta, { filters, scope: departmentScope }),
      channels: await getChannelMetrics(tx, meta, { filters, scope: departmentScope }),
    }));

    expect(data.overview.totals).toMatchObject({
      leadsCreated: 4,
      applications: 2,
      payments: 1,
      revenueRub: "1000.00",
      leadToApplicationPct: 50,
      applicationToPaymentPct: 50,
      leadToPaymentPct: 25,
      averageOrderValueRub: "1000.00",
    });
    expect(data.managers.totals).toEqual(data.overview.totals);
    expect(data.channels.totals).toEqual(data.overview.totals);
    expect(data.managers.rows.map((row) => row.managerKey)).toEqual([
      String(MANAGER_ONE),
      String(MANAGER_TWO),
    ]);
    expect(data.managers.rows[0]?.managerName).toBe("Менеджер один");
    expect(data.channels.rows.map((row) => row.channel)).toEqual(["avito", "site"]);
  });

  it("narrows every block to one manager and never leaks another", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);
    const scope = {
      kind: "manager" as const,
      amoUserIds: [MANAGER_TWO],
      includeUnassigned: false,
    };

    const { data } = await withCurrentSnapshot(db, async (tx, meta) => ({
      overview: await getOverview(tx, meta, { filters, scope, now: NOW }),
      managers: await getManagerMetrics(tx, meta, { filters, scope }),
      funnel: await getFunnelMetrics(tx, meta, { scope }),
    }));

    expect(data.overview.totals).toMatchObject({
      leadsCreated: 2,
      applications: 1,
      payments: 0,
      revenueRub: "0.00",
      applicationToPaymentPct: 0,
      averageOrderValueRub: null,
    });
    expect(data.managers.rows.map((row) => row.managerKey)).toEqual([String(MANAGER_TWO)]);
    expect(data.funnel.stages).toEqual([
      {
        statusId: OPEN_STATUS_ID,
        statusName: "Первичный контакт",
        openCount: 1,
        openAmountRub: "500.00",
        medianAgeSeconds: 1_200,
        averageAgeSeconds: 1_200,
      },
    ]);
  });

  it("returns a null median when a funnel stage spans several managers", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    const { data } = await withCurrentSnapshot(db, (tx, meta) =>
      getFunnelMetrics(tx, meta, { scope: departmentScope }));

    expect(data.stages).toEqual([
      {
        statusId: OPEN_STATUS_ID,
        statusName: "Первичный контакт",
        openCount: 3,
        openAmountRub: "1500.00",
        medianAgeSeconds: null,
        averageAgeSeconds: 1_000,
      },
    ]);
  });

  it("filters by channel and keeps the ratios of the narrowed slice", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    const { data } = await withCurrentSnapshot(db, (tx, meta) =>
      getOverview(tx, meta, {
        filters: { ...filters, channels: ["avito"] as never, allManagers: true },
        scope: departmentScope,
        now: NOW,
      }));

    expect(data.totals).toMatchObject({
      leadsCreated: 1,
      applications: 1,
      payments: 0,
      revenueRub: "0.00",
      leadToApplicationPct: 100,
      averageOrderValueRub: null,
    });
  });

  it("reports the daily series and the previous period of the same snapshot", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    const { data } = await withCurrentSnapshot(db, (tx, meta) =>
      getOverview(tx, meta, { filters, scope: departmentScope, now: NOW }));

    expect(data.daily.map((point) => point.date)).toEqual(["2026-09-05", "2026-09-06"]);
    expect(data.daily[0]?.leadsCreated).toBe(3);
    expect(data.previous).toMatchObject({ leadsCreated: 0, revenueRub: "0.00" });
    expect(data.deltas).toMatchObject({ leadsCreatedPct: null });
  });

  it("reports plan completion from the versioned plan of the month", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);
    await setSalesPlanTarget(db, {
      month: "2026-09-01",
      managerKey: "all",
      metricKey: "payments",
      targetValue: "4.00",
      actorId: testUsers.admin.id,
    });

    const { data } = await withCurrentSnapshot(db, (tx, meta) =>
      getOverview(tx, meta, { filters, scope: departmentScope, now: NOW }));

    expect(data.plans).toContainEqual({
      metricKey: "payments",
      targetValue: "4.00",
      completionPct: 25,
    });
  });

  it("marks the answer stale when the last successful sync is old", async () => {
    const seeded = await seedAccount("2026-09-19T11:40:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    const { data } = await withCurrentSnapshot(db, (tx, meta) =>
      getOverview(tx, meta, { filters, scope: departmentScope, now: NOW }));

    expect(data.stale).toBe(true);
  });

  it("refuses to answer without an approved snapshot instead of showing zeros", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    await seedSnapshot(seeded, "1000.00", "a");

    await expect(
      withCurrentSnapshot(db, async (tx, meta) =>
        getOverview(tx, meta, { filters, scope: departmentScope, now: NOW })),
    ).rejects.toMatchObject({ code: "E_CONFIG_INCOMPLETE" });
  });

  it("refuses a pointer that leads to a snapshot which was never approved", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const candidate = await seedSnapshot(seeded, "1000.00", "a");
    // The pointer alone must not be enough: only an approved snapshot is served.
    await adminDb`
      insert into public.current_snapshot (singleton, snapshot_id)
      values (true, ${candidate.id})
    `;

    await expect(
      withCurrentSnapshot(db, async (tx, meta) =>
        getOverview(tx, meta, { filters, scope: departmentScope, now: NOW })),
    ).rejects.toMatchObject({ code: "E_CONFIG_INCOMPLETE" });
  });

  it("refuses to write inside a dashboard read", async () => {
    const seeded = await seedAccount("2026-09-19T11:55:00Z");
    const snapshot = await seedSnapshot(seeded, "1000.00", "a");
    await approveSnapshot(db, snapshot.id);

    await expect(
      withCurrentSnapshot(db, async (tx) => {
        await tx`update public.metric_snapshots set status = 'published'`;
        return null;
      }),
      // PostgreSQL refuses the write itself: 25006 read_only_sql_transaction.
    ).rejects.toMatchObject({ code: "25006" });
  });
});
