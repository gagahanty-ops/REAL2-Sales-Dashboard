import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDbClient, createDbClient, type Database } from "./client";
import { getSystemControl } from "./identity";
import {
  PROTECTED_SPREADSHEET_ID,
  activateSheetTarget,
  createSheetTarget,
  finishSheetPublication,
  getActiveSheetTarget,
  getSuccessfulPublication,
  listSheetLayoutMappings,
  markSheetTargetValidated,
  replaceSheetLayoutMappings,
  startSheetPublication,
} from "./sheets";
import { createMetricSnapshot } from "./snapshots";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let db: Database;

const FINGERPRINT = "a".repeat(64);
const CHECKSUM = "b".repeat(64);

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
      ${`sheets-${Date.now()}`}, ${connection.id}, ${config.id}, 'incremental',
      'success', now() - interval '5 minutes', now()
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
  return snapshot.id;
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
beforeEach(async () => {
  await clearFixtures();
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
});
afterAll(async () => {
  await clearFixtures();
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

describe("sheet targets", () => {
  it("refuses the protected original spreadsheet", async () => {
    await expect(
      createSheetTarget(db, {
        spreadsheetId: PROTECTED_SPREADSHEET_ID,
        expectedTitle: "Оригинал",
      }),
    ).rejects.toMatchObject({ code: "E_SHEET_PROTECTED" });

    // Even a direct insert is refused by the database itself.
    await expect(adminDb`
      insert into public.sheet_targets (spreadsheet_id, expected_title)
      values (${PROTECTED_SPREADSHEET_ID}, 'Оригинал')
    `).rejects.toThrow(/violates check constraint/iu);
  });

  it("walks a copy from draft to active and keeps only one active target", async () => {
    const first = await createSheetTarget(db, {
      spreadsheetId: "copy-first-spreadsheet-id",
      expectedTitle: "Копия отчёта",
    });
    expect(first.status).toBe("draft");
    await expect(activateSheetTarget(db, first.id, testUsers.admin.id))
      .rejects.toMatchObject({ code: "E_CONFLICT" });

    await markSheetTargetValidated(db, first.id, FINGERPRINT);
    const activated = await activateSheetTarget(db, first.id, testUsers.admin.id);
    expect(activated.status).toBe("active");
    await expect(getActiveSheetTarget(db)).resolves.toMatchObject({ id: first.id });

    const second = await createSheetTarget(db, {
      spreadsheetId: "copy-second-spreadsheet-id",
      expectedTitle: "Вторая копия",
    });
    await markSheetTargetValidated(db, second.id, FINGERPRINT);
    await activateSheetTarget(db, second.id, testUsers.admin.id);

    const active = await getActiveSheetTarget(db);
    expect(active?.id).toBe(second.id);
    const [rows] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.sheet_targets where status = 'active'
    `;
    expect(rows?.count).toBe(1);
  });

  it("replaces mappings as a whole and refuses two mappings on one range", async () => {
    const target = await createSheetTarget(db, {
      spreadsheetId: "copy-mapping-spreadsheet",
      expectedTitle: "Копия",
    });

    await replaceSheetLayoutMappings(db, target.id, [
      {
        reportKind: "channels_daily",
        logicalField: "leads_created",
        sheetName: "Каналы",
        rangeA1: "B2:B32",
        valueType: "integer",
      },
      {
        reportKind: "channels_daily",
        logicalField: "revenue",
        sheetName: "Каналы",
        rangeA1: "C2:C32",
        valueType: "money",
      },
    ]);
    expect(await listSheetLayoutMappings(db, target.id)).toHaveLength(2);

    await replaceSheetLayoutMappings(db, target.id, [
      {
        reportKind: "plan_fact",
        logicalField: "payments",
        sheetName: "План",
        rangeA1: "D5",
        valueType: "integer",
      },
    ]);
    const mappings = await listSheetLayoutMappings(db, target.id);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.reportKind).toBe("plan_fact");

    await expect(
      replaceSheetLayoutMappings(db, target.id, [
        {
          reportKind: "channels_daily",
          logicalField: "leads_created",
          sheetName: "Каналы",
          rangeA1: "B2:B32",
          valueType: "integer",
        },
        {
          reportKind: "plan_fact",
          logicalField: "payments",
          sheetName: "Каналы",
          rangeA1: "B2:B32",
          valueType: "integer",
        },
      ]),
    ).rejects.toThrow(/duplicate key/iu);
  });
});

describe("publication attempts", () => {
  async function activeTarget(): Promise<string> {
    const target = await createSheetTarget(db, {
      spreadsheetId: "copy-publication-spreadsheet",
      expectedTitle: "Копия",
    });
    await markSheetTargetValidated(db, target.id, FINGERPRINT);
    await activateSheetTarget(db, target.id, testUsers.admin.id);
    return target.id;
  }

  it("allows one successful publication per target and snapshot", async () => {
    const targetId = await activeTarget();
    const snapshotId = await seedSnapshot();

    const first = await startSheetPublication(db, {
      traceId: "trace-success-1",
      targetId,
      snapshotId,
      attempt: 1,
      layoutFingerprint: FINGERPRINT,
      payloadChecksum: CHECKSUM,
      cellsPlanned: 10,
    });
    await finishSheetPublication(db, {
      publicationId: first.id,
      status: "success",
      cellsWritten: 10,
    });

    const second = await startSheetPublication(db, {
      traceId: "trace-success-2",
      targetId,
      snapshotId,
      attempt: 2,
      layoutFingerprint: FINGERPRINT,
      payloadChecksum: CHECKSUM,
      cellsPlanned: 10,
    });
    await expect(
      finishSheetPublication(db, {
        publicationId: second.id,
        status: "success",
        cellsWritten: 10,
      }),
    ).rejects.toThrow(/unique|duplicate/iu);

    await expect(getSuccessfulPublication(db, targetId, snapshotId)).resolves
      .toMatchObject({ attempt: 1 });
  });

  it("records a failed attempt with a safe code and keeps it immutable", async () => {
    const targetId = await activeTarget();
    const snapshotId = await seedSnapshot();

    const attempt = await startSheetPublication(db, {
      traceId: "trace-failed",
      targetId,
      snapshotId,
      attempt: 1,
      layoutFingerprint: FINGERPRINT,
      payloadChecksum: CHECKSUM,
      cellsPlanned: 4,
    });
    const failed = await finishSheetPublication(db, {
      publicationId: attempt.id,
      status: "failed",
      cellsWritten: 0,
      errorCode: "E_SHEET_UPSTREAM",
      errorSummary: "Google ответил 503",
    });

    expect(failed).toMatchObject({ status: "failed", cellsWritten: 0 });
    await expect(adminDb`
      update public.sheet_publications set status = 'success' where id = ${attempt.id}
    `).rejects.toThrow(/immutable/iu);
    await expect(adminDb`
      delete from public.sheet_publications where id = ${attempt.id}
    `).rejects.toThrow(/never deleted/iu);
  });

  it("refuses to call a publication successful when cells are missing", async () => {
    const targetId = await activeTarget();
    const snapshotId = await seedSnapshot();
    const attempt = await startSheetPublication(db, {
      traceId: "trace-partial",
      targetId,
      snapshotId,
      attempt: 1,
      layoutFingerprint: FINGERPRINT,
      payloadChecksum: CHECKSUM,
      cellsPlanned: 10,
    });

    await expect(
      finishSheetPublication(db, {
        publicationId: attempt.id,
        status: "success",
        cellsWritten: 9,
      }),
    ).rejects.toThrow(/violates check constraint/iu);
  });
});

describe("external switches", () => {
  it("starts both database controls disabled after a reset", async () => {
    await expect(getSystemControl(db, "sync_enabled")).resolves.toMatchObject({
      enabled: false,
    });
    await expect(getSystemControl(db, "sheet_publish_enabled")).resolves.toMatchObject({
      enabled: false,
    });
  });
});
