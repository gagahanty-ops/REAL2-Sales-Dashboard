import {
  activateSheetTarget,
  createMetricSnapshot,
  createSheetTarget,
  getSystemControl,
  listAlerts,
  markSheetTargetValidated,
  replaceSheetLayoutMappings,
  closeDbClient,
  createDbClient,
  type Database,
} from "@real2/db";
import { computeLayoutFingerprint, type SheetClient, type SheetMetadata } from "@real2/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../../tests/helpers/local-db";
import { publishSheet } from "./publish-sheet";

const adminDb = createAdminDb();
let db: Database;

const COPY_ID = "1CopySpreadsheetIdentifierForTests_0001";
const CHANNELS_SHEET = "каналы сентябрь 2026";
const PLAN_SHEET = "выполнение плана сентябрь 2026";

const metadata: SheetMetadata = {
  title: "Копия отчёта РЕАЛ ДВА",
  sheets: [
    { title: CHANNELS_SHEET, rowCount: 100, columnCount: 12 },
    { title: PLAN_SHEET, rowCount: 50, columnCount: 8 },
  ],
};

const CHANNEL_FIELDS = [
  ["report_date", "A", "date"],
  ["channel", "B", "text"],
  ["leads_created", "C", "integer"],
  ["applications", "D", "integer"],
  ["payments", "E", "integer"],
  ["revenue", "F", "money"],
] as const;

const PLAN_FIELDS = [
  ["metric", "A", "text"],
  ["plan_target", "B", "text"],
  ["actual_value", "C", "text"],
  ["completion_pct", "D", "percent"],
] as const;

function mappings() {
  return [
    ...CHANNEL_FIELDS.map(([logicalField, column, valueType]) => ({
      reportKind: "channels_daily" as const,
      logicalField,
      sheetName: CHANNELS_SHEET,
      rangeA1: `${column}2:${column}4`,
      valueType,
    })),
    ...PLAN_FIELDS.map(([logicalField, column, valueType]) => ({
      reportKind: "plan_fact" as const,
      logicalField,
      sheetName: PLAN_SHEET,
      rangeA1: `${column}2:${column}3`,
      valueType,
    })),
  ];
}

const report = {
  channelsDaily: [
    {
      report_date: "2026-09-05",
      channel: "site",
      leads_created: 3,
      applications: 2,
      payments: 1,
      revenue: "120000.50",
    },
  ],
  planFact: [
    { metric: "payments", plan_target: "4", actual_value: "1", completion_pct: 25 },
  ],
};

type Fake = Readonly<{
  client: SheetClient;
  batches: () => number;
  ranges: () => readonly string[];
}>;

function fakeSheet(
  options: Readonly<{ meta?: SheetMetadata; corrupt?: boolean }> = {},
): Fake {
  const stored = new Map<string, string[][]>();
  let batches = 0;
  const ranges: string[] = [];
  return {
    batches: () => batches,
    ranges: () => ranges,
    client: {
      readMetadata: async () => options.meta ?? metadata,
      readValues: async (range) => stored.get(range) ?? [],
      writeValues: async (updates) => {
        batches += 1;
        let cells = 0;
        for (const update of updates) {
          ranges.push(update.range);
          stored.set(
            update.range,
            update.values.map((row) =>
              row.map((cell) => (options.corrupt ? "подменено" : String(cell ?? "")))),
          );
          cells += update.values.length;
        }
        return { updatedCells: cells };
      },
    },
  };
}

function deps(fake: Fake, overrides: Partial<Parameters<typeof publishSheet>[0]> = {}) {
  return {
    db,
    factory: async () => fake.client,
    secrets: {
      readGoogleServiceAccount: async () => ({
        clientEmail: "publisher@example.iam.gserviceaccount.com",
        privateKey: "synthetic",
      }),
    },
    publishEnabledInEnvironment: true,
    loadReport: async () => report,
    traceId: `trace-${Math.random().toString(36).slice(2)}`,
    sleep: async () => undefined,
    ...overrides,
  };
}

async function seedSnapshot(): Promise<string> {
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      9001, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
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
      ${connection.id}, 77, 'Продажи', 771, 'Заявка', 772, 'Успешно', 1, true,
      ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing config");
  const [run] = await adminDb<{ id: string }[]>`
    insert into public.sync_runs (
      trace_id, connection_id, config_id, kind, status, started_at, finished_at
    ) values (
      ${`publish-${Date.now()}-${Math.random()}`}, ${connection.id}, ${config.id},
      'incremental', 'success', now() - interval '5 minutes', now()
    ) returning id
  `;
  if (!run) throw new Error("missing run");
  const snapshot = await createMetricSnapshot(db, {
    syncRunId: run.id,
    configId: config.id,
    sourceFreshAt: new Date(),
    checksum: "c".repeat(64),
    qualitySummary: {},
    cells: [],
    facts: [],
    stageRows: [],
  });
  await adminDb`
    update public.metric_snapshots set status = 'approved', approved_at = now()
    where id = ${snapshot.id}
  `;
  return snapshot.id;
}

async function seedActiveTarget(): Promise<void> {
  const target = await createSheetTarget(db, {
    spreadsheetId: COPY_ID,
    expectedTitle: metadata.title,
  });
  await replaceSheetLayoutMappings(db, target.id, mappings());
  await markSheetTargetValidated(db, target.id, computeLayoutFingerprint(metadata));
  await activateSheetTarget(db, target.id, testUsers.admin.id);
}

async function enablePublication(): Promise<void> {
  await adminDb`
    update public.system_controls set enabled = true where key = 'sheet_publish_enabled'
  `;
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  await adminDb`
    update public.system_controls set enabled = false, reason = 'test reset'
    where key in ('sync_enabled', 'sheet_publish_enabled')
  `;
}

beforeAll(() => {
  db = createDbClient(localDatabaseUrl, { max: 4 });
});
beforeEach(async () => {
  await clearFixtures();
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
});
afterAll(async () => {
  await clearFixtures();
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

describe("publishSheet", () => {
  it("writes one batch from one snapshot and records the checksum", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();
    const fake = fakeSheet();

    const result = await publishSheet(deps(fake), snapshotId);

    expect(result.status).toBe("success");
    expect(fake.batches()).toBe(1);
    expect(result.publication).toMatchObject({ status: "success", attempt: 1 });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/u);
    // Only the mapped ranges were touched.
    expect(fake.ranges().every((range) =>
      range.startsWith(`${CHANNELS_SHEET}!`) || range.startsWith(`${PLAN_SHEET}!`))).toBe(true);
    expect(fake.ranges()).toHaveLength(10);
  });

  it("does not write the same snapshot twice", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();
    const fake = fakeSheet();
    await publishSheet(deps(fake), snapshotId);

    const second = await publishSheet(deps(fake), snapshotId);

    expect(second.status).toBe("skipped");
    expect(fake.batches()).toBe(1);
  });

  it("writes nothing while the database switch is off", async () => {
    await seedActiveTarget();
    const snapshotId = await seedSnapshot();
    const fake = fakeSheet();

    await expect(publishSheet(deps(fake), snapshotId)).rejects.toMatchObject({
      code: "E_FORBIDDEN",
    });
    expect(fake.batches()).toBe(0);
    const [attempt] = await adminDb<{ status: string; error_code: string }[]>`
      select status, error_code from public.sheet_publications
    `;
    expect(attempt).toMatchObject({ status: "failed", error_code: "E_FORBIDDEN" });
  });

  it("writes nothing while the environment switch is off", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();
    const fake = fakeSheet();

    await expect(
      publishSheet(deps(fake, { publishEnabledInEnvironment: false }), snapshotId),
    ).rejects.toMatchObject({ code: "E_FORBIDDEN" });
    expect(fake.batches()).toBe(0);
  });

  it("blocks publication and disables the switch when the layout drifted", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();
    const drifted = fakeSheet({
      meta: {
        title: metadata.title,
        sheets: [
          { title: CHANNELS_SHEET, rowCount: 100, columnCount: 13 },
          { title: PLAN_SHEET, rowCount: 50, columnCount: 8 },
        ],
      },
    });

    await expect(publishSheet(deps(drifted), snapshotId)).rejects.toMatchObject({
      code: "E_SHEET_LAYOUT_MISMATCH",
    });

    expect(drifted.batches()).toBe(0);
    const [attempt] = await adminDb<{ status: string; error_code: string }[]>`
      select status, error_code from public.sheet_publications
    `;
    expect(attempt).toMatchObject({
      status: "blocked",
      error_code: "E_SHEET_LAYOUT_MISMATCH",
    });
    await expect(getSystemControl(db, "sheet_publish_enabled")).resolves.toMatchObject({
      enabled: false,
    });
    const alerts = await listAlerts(db, { status: "open" });
    expect(alerts[0]).toMatchObject({
      source: "sheet_publication",
      code: "E_SHEET_LAYOUT_MISMATCH",
      severity: "critical",
    });
  });

  it("disables publication when the copy does not read back what was written", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();
    const corrupt = fakeSheet({ corrupt: true });

    await expect(publishSheet(deps(corrupt), snapshotId)).rejects.toMatchObject({
      code: "E_SHEET_UPSTREAM",
    });

    await expect(getSystemControl(db, "sheet_publish_enabled")).resolves.toMatchObject({
      enabled: false,
    });
    const [attempt] = await adminDb<{ status: string; cells_written: number }[]>`
      select status, cells_written from public.sheet_publications
    `;
    expect(attempt).toMatchObject({ status: "failed", cells_written: 0 });
  });

  it("refuses to publish without an active target", async () => {
    await enablePublication();
    const snapshotId = await seedSnapshot();

    await expect(publishSheet(deps(fakeSheet()), snapshotId)).rejects.toMatchObject({
      code: "E_CONFIG_INCOMPLETE",
    });
  });

  it("numbers a retry attempt after a failure and resolves the alert on success", async () => {
    await seedActiveTarget();
    await enablePublication();
    const snapshotId = await seedSnapshot();

    await expect(publishSheet(deps(fakeSheet({ corrupt: true })), snapshotId)).rejects
      .toThrow();
    await enablePublication();
    const result = await publishSheet(deps(fakeSheet()), snapshotId);

    expect(result.publication.attempt).toBe(2);
    await expect(listAlerts(db, { status: "open" })).resolves.toHaveLength(0);
  });
});
