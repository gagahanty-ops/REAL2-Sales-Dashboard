import {
  approveSnapshot,
  closeDbClient,
  createDbClient,
  createMetricSnapshot,
  getCurrentSnapshot,
  listSalesPlans,
  setSalesPlanTarget,
  validateSnapshot,
  type Database,
} from "@real2/db";
import { AppError } from "@real2/domain";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../../tests/helpers/local-db";
import { buildMetricSnapshot } from "./build-snapshot";

const adminDb = createAdminDb();
let db: Database;

const ACCOUNT_ID = 9001;
const PIPELINE_ID = 77;
const OPEN_STATUS_ID = 770;
const APPLICATION_STATUS_ID = 771;
const WON_STATUS_ID = 772;
const MANAGER_ONE = 601;
const MANAGER_TWO = 602;
const RUN_FINISHED_AT = new Date("2026-09-12T00:00:00.000Z");

type Fixture = Readonly<{ connectionId: string; configId: string; syncRunId: string }>;

async function seedFixture(): Promise<Fixture> {
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
  if (!connection) throw new Error("missing synthetic connection");
  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id, pipeline_id, pipeline_name, application_status_id,
      application_status_name, won_status_id, won_status_name, version,
      is_active, confirmed_by
    ) values (
      ${connection.id}, ${PIPELINE_ID}, 'Synthetic', ${APPLICATION_STATUS_ID},
      'Application', ${WON_STATUS_ID}, 'Won', 1, true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing synthetic config");
  const [run] = await adminDb<{ id: string }[]>`
    insert into public.sync_runs (
      trace_id, connection_id, config_id, kind, status, started_at, finished_at,
      source_max_updated_at
    ) values (
      ${`snapshot-trace-${Date.now()}`}, ${connection.id}, ${config.id},
      'incremental', 'success', '2026-09-11T23:00:00Z', ${RUN_FINISHED_AT},
      '2026-09-11T22:00:00Z'
    ) returning id
  `;
  if (!run) throw new Error("missing synthetic run");

  for (const [statusId, name, sort] of [
    [OPEN_STATUS_ID, "Открыт", 10],
    [APPLICATION_STATUS_ID, "Заявка", 20],
    [WON_STATUS_ID, "Успешно реализовано", 30],
  ] as const) {
    await adminDb`
      insert into public.pipeline_statuses (
        account_id, pipeline_id, status_id, name, sort_order, is_closed, is_won
      ) values (
        ${ACCOUNT_ID}, ${PIPELINE_ID}, ${statusId}, ${name}, ${sort},
        ${statusId === WON_STATUS_ID}, ${statusId === WON_STATUS_ID}
      )
    `;
  }
  for (const [userId, name] of [
    [MANAGER_ONE, "Менеджер один"],
    [MANAGER_TWO, "Менеджер два"],
  ] as const) {
    await adminDb`
      insert into public.amo_users (account_id, amo_user_id, name, email, is_active)
      values (${ACCOUNT_ID}, ${userId}, ${name}, null, true)
    `;
  }
  return { connectionId: connection.id, configId: config.id, syncRunId: run.id };
}

type LeadSeed = Readonly<{
  amoLeadId: number;
  statusId: number;
  responsibleUserId: number | null;
  name?: string;
  priceRub?: string | null;
  createdDate: string;
  channel: string;
  applicationAt?: string | null;
  wonAt?: string | null;
  currentlyWon?: boolean;
}>;

async function seedLead(configId: string, seed: LeadSeed): Promise<void> {
  await adminDb`
    insert into public.leads (
      account_id, amo_lead_id, pipeline_id, current_status_id,
      current_responsible_user_id, name, price_rub, created_at, created_date,
      source_updated_at, normalized_channel, normalization_config_id, amo_url
    ) values (
      ${ACCOUNT_ID}, ${seed.amoLeadId}, ${PIPELINE_ID}, ${seed.statusId},
      ${seed.responsibleUserId}, ${seed.name ?? "Синтетическая сделка"},
      ${seed.priceRub ?? null}, ${`${seed.createdDate}T09:00:00Z`},
      ${seed.createdDate}, ${`${seed.createdDate}T09:30:00Z`}, ${seed.channel},
      ${configId}, ${`https://555151.amocrm.ru/leads/detail/${seed.amoLeadId}`}
    )
  `;
  await adminDb`
    insert into public.lead_milestones (
      account_id, amo_lead_id, application_at, application_responsible_user_id,
      won_at, won_responsible_user_id, currently_won
    ) values (
      ${ACCOUNT_ID}, ${seed.amoLeadId}, ${seed.applicationAt ?? null},
      ${seed.responsibleUserId}, ${seed.wonAt ?? null}, ${seed.responsibleUserId},
      ${seed.currentlyWon ?? false}
    )
  `;
  await adminDb`
    insert into public.lead_stage_events (
      account_id, amo_event_id, amo_lead_id, from_status_id, to_status_id,
      responsible_user_id, occurred_at
    ) values (
      ${ACCOUNT_ID}, ${`evt-${seed.amoLeadId}`}, ${seed.amoLeadId}, null,
      ${seed.statusId}, ${seed.responsibleUserId},
      ${`${seed.createdDate}T10:00:00Z`}
    )
  `;
}

async function seedTypicalLeads(configId: string): Promise<void> {
  await seedLead(configId, {
    amoLeadId: 101,
    statusId: OPEN_STATUS_ID,
    responsibleUserId: MANAGER_ONE,
    createdDate: "2026-09-05",
    channel: "site",
  });
  await seedLead(configId, {
    amoLeadId: 102,
    statusId: WON_STATUS_ID,
    responsibleUserId: MANAGER_TWO,
    priceRub: "12500.50",
    createdDate: "2026-09-05",
    channel: "avito",
    applicationAt: "2026-09-06T09:00:00Z",
    wonAt: "2026-09-07T09:00:00Z",
    currentlyWon: true,
  });
  await seedLead(configId, {
    amoLeadId: 103,
    statusId: APPLICATION_STATUS_ID,
    responsibleUserId: null,
    name: "+7 900 000-00-11",
    createdDate: "2026-09-06",
    channel: "unknown",
    applicationAt: "2026-09-07T09:00:00Z",
  });
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
afterEach(clearFixtures);
afterAll(async () => {
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

describe("buildMetricSnapshot", () => {
  it("writes cells, facts and stage rows that cross-foot", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);

    const snapshot = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    expect(snapshot.status).toBe("candidate");
    expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
    const [total] = await adminDb<{
      leads_created: number; applications: number; payments: number; revenue: string;
    }[]>`
      select leads_created, applications, payments, revenue from public.metric_cells
      where snapshot_id = ${snapshot.id} and report_date = '2026-09-05'
        and manager_key = 'all' and channel_key = 'all'
    `;
    expect(total).toMatchObject({
      leads_created: 2,
      applications: 1,
      payments: 1,
      revenue: "12500.50",
    });
    const facts = await adminDb<{ amo_lead_id: string; display_name: string }[]>`
      select amo_lead_id, display_name from public.metric_lead_facts
      where snapshot_id = ${snapshot.id} order by amo_lead_id
    `;
    expect(facts).toHaveLength(3);
    // A name that is mostly a phone number never reaches the snapshot.
    expect(facts[2]?.display_name).toBe("Сделка #103");
    const stages = await adminDb<{ status_id: string; open_count: number }[]>`
      select status_id, open_count from public.stage_snapshot_rows
      where snapshot_id = ${snapshot.id} order by status_id
    `;
    expect(stages.map((row) => row.status_id)).toEqual([
      String(OPEN_STATUS_ID),
      String(APPLICATION_STATUS_ID),
    ]);
    await expect(validateSnapshot(db, snapshot.id)).resolves.toMatchObject({
      approved: true,
      failures: [],
    });
  });

  it("rebuilding identical input produces the same checksum", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);

    const first = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);
    const second = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    expect(second.checksum).toBe(first.checksum);
    expect(second.id).toBe(first.id);
    const [count] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.metric_snapshots
    `;
    expect(count?.count).toBe(1);
  });

  it("refuses to rebuild the same run when the normalized data changed", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);
    await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    await seedLead(fixture.configId, {
      amoLeadId: 104,
      statusId: OPEN_STATUS_ID,
      responsibleUserId: MANAGER_ONE,
      createdDate: "2026-09-08",
      channel: "site",
    });

    await expect(
      buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("approves a clean candidate and moves the current pointer", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);
    const candidate = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    const approved = await approveSnapshot(db, candidate.id);

    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    await expect(getCurrentSnapshot(db)).resolves.toMatchObject({ id: candidate.id });
  });

  it("keeps the previous current snapshot when a candidate is blocked", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);
    const current = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);
    await approveSnapshot(db, current.id);

    const [secondRun] = await adminDb<{ id: string }[]>`
      insert into public.sync_runs (
        trace_id, connection_id, config_id, kind, status, started_at, finished_at
      ) values (
        ${`snapshot-trace-blocked-${Date.now()}`}, ${fixture.connectionId},
        ${fixture.configId}, 'incremental', 'success', '2026-09-12T10:00:00Z',
        '2026-09-12T11:00:00Z'
      ) returning id
    `;
    if (!secondRun) throw new Error("missing second run");
    await adminDb`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity, status
      ) values (${ACCOUNT_ID}, 101, 'missing_stage_history', 'blocking', 'open')
    `;
    const blocked = await buildMetricSnapshot({ db }, secondRun.id, fixture.configId);

    await expect(approveSnapshot(db, blocked.id)).rejects.toMatchObject({
      code: "E_DATA_QUALITY_BLOCK",
    });
    await expect(getCurrentSnapshot(db)).resolves.toMatchObject({ id: current.id });
    const [row] = await adminDb<{ status: string }[]>`
      select status from public.metric_snapshots where id = ${blocked.id}
    `;
    expect(row?.status).toBe("candidate");
  });

  it("reports a blocking issue that an admin accepted as no longer blocking", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);
    await adminDb`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity, status
      ) values (${ACCOUNT_ID}, 101, 'won_without_valid_price', 'blocking', 'open')
    `;
    const blocked = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);
    await expect(validateSnapshot(db, blocked.id)).resolves.toMatchObject({
      approved: false,
      failures: ["quality_gate_blocked"],
    });

    await adminDb`
      update public.data_quality_issues set status = 'accepted', resolved_at = now()
      where code = 'won_without_valid_price'
    `;

    await expect(validateSnapshot(db, blocked.id)).resolves.toMatchObject({
      approved: true,
    });
  });

  it("refuses to approve evidence that does not cross-foot", async () => {
    const fixture = await seedFixture();
    const tampered = await createMetricSnapshot(db, {
      syncRunId: fixture.syncRunId,
      configId: fixture.configId,
      sourceFreshAt: RUN_FINISHED_AT,
      checksum: "b".repeat(64),
      qualitySummary: {},
      cells: [
        {
          reportDate: "2026-09-05",
          managerKey: "all",
          channelKey: "all",
          leadsCreated: 5,
          applications: 1,
          payments: 1,
          revenue: "100.00",
        },
        {
          reportDate: "2026-09-05",
          managerKey: String(MANAGER_ONE),
          channelKey: "all",
          leadsCreated: 1,
          applications: 1,
          payments: 1,
          revenue: "100.00",
        },
        {
          reportDate: "2026-09-05",
          managerKey: "all",
          channelKey: "site",
          leadsCreated: 1,
          applications: 1,
          payments: 1,
          revenue: "100.00",
        },
      ],
      facts: [],
      stageRows: [],
    });

    await expect(validateSnapshot(db, tampered.id)).resolves.toMatchObject({
      approved: false,
    });
    await expect(approveSnapshot(db, tampered.id)).rejects.toMatchObject({
      code: "E_DATA_QUALITY_BLOCK",
    });
  });

  it("names the cross-foot mismatch when only the breakdowns disagree", async () => {
    const fixture = await seedFixture();
    const mismatched = await createMetricSnapshot(db, {
      syncRunId: fixture.syncRunId,
      configId: fixture.configId,
      sourceFreshAt: RUN_FINISHED_AT,
      checksum: "d".repeat(64),
      qualitySummary: {},
      cells: [
        {
          reportDate: "2026-09-05",
          managerKey: "all",
          channelKey: "all",
          leadsCreated: 2,
          applications: 0,
          payments: 0,
          revenue: "0.00",
        },
        {
          reportDate: "2026-09-05",
          managerKey: String(MANAGER_ONE),
          channelKey: "all",
          leadsCreated: 1,
          applications: 0,
          payments: 0,
          revenue: "0.00",
        },
        {
          reportDate: "2026-09-05",
          managerKey: "all",
          channelKey: "site",
          leadsCreated: 2,
          applications: 0,
          payments: 0,
          revenue: "0.00",
        },
      ],
      facts: [],
      stageRows: [],
    });

    await expect(validateSnapshot(db, mismatched.id)).resolves.toEqual({
      approved: false,
      failures: ["cross_foot_mismatch"],
      blockingCodes: [],
    });
  });

  it("refuses a total that has no breakdown to cross-foot against", async () => {
    const fixture = await seedFixture();
    const orphaned = await createMetricSnapshot(db, {
      syncRunId: fixture.syncRunId,
      configId: fixture.configId,
      sourceFreshAt: RUN_FINISHED_AT,
      checksum: "e".repeat(64),
      qualitySummary: {},
      cells: [
        {
          reportDate: "2026-09-05",
          managerKey: "all",
          channelKey: "all",
          leadsCreated: 1,
          applications: 0,
          payments: 0,
          revenue: "0.00",
        },
      ],
      facts: [],
      stageRows: [],
    });

    await expect(validateSnapshot(db, orphaned.id)).resolves.toEqual({
      approved: false,
      failures: ["cross_foot_missing_breakdown"],
      blockingCodes: [],
    });
  });

  it("keeps snapshot evidence immutable", async () => {
    const fixture = await seedFixture();
    await seedTypicalLeads(fixture.configId);
    const snapshot = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    await expect(adminDb`
      update public.metric_cells set leads_created = 99 where snapshot_id = ${snapshot.id}
    `).rejects.toThrow(/immutable/i);
    await expect(adminDb`
      delete from public.metric_lead_facts where snapshot_id = ${snapshot.id}
    `).rejects.toThrow(/immutable/i);
    await expect(adminDb`
      update public.metric_snapshots set checksum = ${"c".repeat(64)}
      where id = ${snapshot.id}
    `).rejects.toThrow(/immutable/i);
    await expect(adminDb`
      delete from public.metric_snapshots where id = ${snapshot.id}
    `).rejects.toThrow(/never deleted/i);
  });

  it("refuses a run that did not succeed and an unknown run", async () => {
    const fixture = await seedFixture();
    await adminDb`
      update public.sync_runs set status = 'failed' where id = ${fixture.syncRunId}
    `;

    await expect(
      buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId),
    ).rejects.toThrow(AppError);
    await expect(
      buildMetricSnapshot(
        { db },
        "00000000-0000-4000-8000-000000000000",
        fixture.configId,
      ),
    ).rejects.toThrow(AppError);
  });
});

describe("versioned sales plans", () => {
  it("closes the previous target and never overwrites history", async () => {
    await seedFixture();

    const first = await setSalesPlanTarget(db, {
      month: "2026-09-01",
      managerKey: "all",
      metricKey: "revenue",
      targetValue: "1000000.00",
      actorId: testUsers.admin.id,
      now: new Date("2026-09-01T09:00:00Z"),
    });
    const second = await setSalesPlanTarget(db, {
      month: "2026-09-01",
      managerKey: "all",
      metricKey: "revenue",
      targetValue: "1200000.00",
      actorId: testUsers.admin.id,
      now: new Date("2026-09-10T09:00:00Z"),
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const history = await listSalesPlans(db, { month: "2026-09-01" });
    expect(history.map((plan) => plan.targetValue)).toEqual([
      "1200000.00",
      "1000000.00",
    ]);
    expect(history[1]?.validTo).not.toBeNull();
    const current = await listSalesPlans(db, { month: "2026-09-01", currentOnly: true });
    expect(current).toHaveLength(1);
    expect(current[0]?.targetValue).toBe("1200000.00");
  });

  it("refuses a mid-month date, an unsupported metric and a non-positive target", async () => {
    await seedFixture();
    const base = {
      managerKey: "all",
      metricKey: "revenue" as const,
      targetValue: "1000.00",
      actorId: testUsers.admin.id,
    };

    await expect(setSalesPlanTarget(db, { ...base, month: "2026-09-15" }))
      .rejects.toThrow(AppError);
    await expect(
      setSalesPlanTarget(db, { ...base, month: "2026-09-01", targetValue: "0.00" }),
    ).rejects.toThrow(AppError);
    await expect(
      setSalesPlanTarget(db, {
        ...base,
        month: "2026-09-01",
        metricKey: "made_up" as never,
      }),
    ).rejects.toThrow(AppError);
  });

  it("refuses to rewrite a closed plan row", async () => {
    await seedFixture();
    const plan = await setSalesPlanTarget(db, {
      month: "2026-09-01",
      managerKey: "all",
      metricKey: "payments",
      targetValue: "30.00",
      actorId: testUsers.admin.id,
    });

    await expect(adminDb`
      update public.sales_plans set target_value = 99 where id = ${plan.id}
    `).rejects.toThrow(/immutable/i);
    await expect(adminDb`
      delete from public.sales_plans where id = ${plan.id}
    `).rejects.toThrow(/immutable/i);
  });
});
