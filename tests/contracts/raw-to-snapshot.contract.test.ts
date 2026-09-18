import { createHash } from "node:crypto";

import {
  approveSnapshot,
  acceptQualityIssue,
  closeDbClient,
  createDbClient,
  createNormalizeRunRepository,
  exportComparableRows,
  getActivePipelineConfig,
  getCurrentSnapshot,
  type Database,
} from "@real2/db";
import {
  GOLDEN_ACCOUNT_ID,
  GOLDEN_APPLICATION_STATUS_ID,
  GOLDEN_CHANNEL_RULES,
  GOLDEN_PIPELINE_ID,
  GOLDEN_SOURCE_FIELD_ID,
  GOLDEN_WON_STATUS_ID,
  goldenChannelRows,
  goldenDailyRows,
  goldenManagerRows,
  goldenRawEvents,
  goldenRawLeads,
  goldenRawStatuses,
  goldenRawUsers,
  goldenRepeatedEvents,
  type GoldenRawEvent,
  type GoldenRawObject,
} from "@real2/testkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildMetricSnapshot } from "../../apps/worker/src/jobs/build-snapshot";
import { normalizeSyncRun } from "../../apps/worker/src/jobs/normalize-sync-run";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../helpers/local-db";

const adminDb = createAdminDb();
let db: Database;

type Fixture = Readonly<{ connectionId: string; configId: string; syncRunId: string }>;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function seedAccount(): Promise<Fixture> {
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      ${GOLDEN_ACCOUNT_ID}, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
      ${Buffer.alloc(64)}, '2030-01-01T00:00:00Z', 'active', ${testUsers.admin.id}
    ) returning id
  `;
  if (!connection) throw new Error("missing golden connection");
  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id, pipeline_id, pipeline_name, application_status_id,
      application_status_name, won_status_id, won_status_name, source_field_id,
      version, is_active, confirmed_by
    ) values (
      ${connection.id}, ${GOLDEN_PIPELINE_ID}, 'Golden', ${GOLDEN_APPLICATION_STATUS_ID},
      'Заявка', ${GOLDEN_WON_STATUS_ID}, 'Успешно реализовано',
      ${GOLDEN_SOURCE_FIELD_ID}, 1, true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing golden configuration");
  for (const rule of GOLDEN_CHANNEL_RULES) {
    await adminDb`
      insert into public.channel_rules (
        config_id, priority, match_type, match_value, normalized_channel, created_by
      ) values (
        ${config.id}, ${rule.priority}, 'source_field_exact', ${rule.matchValue},
        ${rule.normalizedChannel}, ${testUsers.admin.id}
      )
    `;
  }
  await adminDb`
    insert into public.config_validations (
      config_id, pipeline_found, application_status_found, won_status_found,
      source_field_found, metadata_checksum
    ) values (${config.id}, true, true, true, true, ${"a".repeat(64)})
  `;
  const [run] = await adminDb<{ id: string }[]>`
    insert into public.sync_runs (
      trace_id, connection_id, config_id, kind, status, started_at
    ) values (
      ${`golden-${Date.now()}`}, ${connection.id}, ${config.id}, 'initial_backfill',
      'running', '2026-10-05T09:00:00Z'
    ) returning id
  `;
  if (!run) throw new Error("missing golden run");
  return { connectionId: connection.id, configId: config.id, syncRunId: run.id };
}

async function ingestRawObject(
  syncRunId: string,
  object: GoldenRawObject,
): Promise<void> {
  await adminDb`
    insert into public.raw_amo_objects (
      sync_run_id, account_id, entity_type, external_id, source_updated_at,
      payload, payload_sha256
    ) values (
      ${syncRunId}, ${GOLDEN_ACCOUNT_ID}, ${object.entityType}, ${object.externalId},
      ${object.sourceUpdatedAt}, ${adminDb.json(object.payload as never)},
      ${sha256(object.payload)}
    )
    on conflict (sync_run_id, entity_type, external_id) do nothing
  `;
}

async function ingestRawEvent(syncRunId: string, event: GoldenRawEvent): Promise<void> {
  await adminDb`
    insert into public.raw_amo_events (
      sync_run_id, account_id, amo_event_id, amo_lead_id, event_type, event_at,
      payload, payload_sha256
    ) values (
      ${syncRunId}, ${GOLDEN_ACCOUNT_ID}, ${event.amoEventId}, ${event.amoLeadId},
      ${event.eventType}, ${event.eventAt}, ${adminDb.json(event.payload as never)},
      ${sha256(event.payload)}
    )
    on conflict (account_id, amo_event_id) do nothing
  `;
}

/** Ingests the golden raw dataset exactly as a successful sync run would. */
async function ingestGoldenRawDataset(fixture: Fixture): Promise<void> {
  for (const object of [...goldenRawStatuses, ...goldenRawUsers, ...goldenRawLeads]) {
    await ingestRawObject(fixture.syncRunId, object);
  }
  for (const event of goldenRawEvents) await ingestRawEvent(fixture.syncRunId, event);
  // Scenario 9: the same events delivered a second time.
  for (const event of goldenRepeatedEvents) await ingestRawEvent(fixture.syncRunId, event);
  await adminDb`
    update public.sync_runs
    set status = 'success', finished_at = '2026-10-05T10:00:00Z',
      source_max_updated_at = '2026-10-05T09:30:00Z'
    where id = ${fixture.syncRunId}
  `;
}

function buildDeps() {
  return {
    repository: createNormalizeRunRepository(db),
    loadActiveConfig: (connectionId: string) =>
      getActivePipelineConfig(db, connectionId),
  };
}

function comparable(
  rows: readonly Readonly<{ metrics: { leadsCreated: number; applications: number; payments: number; revenueRub: string } }>[],
  keyOf: (row: never) => string,
): readonly unknown[] {
  return rows.map((row) => ({
    key: keyOf(row as never),
    leadsCreated: row.metrics.leadsCreated,
    applications: row.metrics.applications,
    payments: row.metrics.payments,
    revenue: row.metrics.revenueRub,
  }));
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
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

describe("raw amoCRM data to an approved snapshot", () => {
  it("matches the approved golden daily, manager and channel rows", async () => {
    const fixture = await seedAccount();
    await ingestGoldenRawDataset(fixture);

    const normalized = await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    expect(normalized.leadsNormalized).toBe(11);
    expect(normalized.leadsRejected).toBe(0);

    const candidate = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    // Scenario 8 opens a blocking issue, so the candidate cannot be approved
    // until an admin accepts that known exception.
    await expect(approveSnapshot(db, candidate.id)).rejects.toMatchObject({
      code: "E_DATA_QUALITY_BLOCK",
    });
    const [issue] = await adminDb<{ id: string }[]>`
      select id from public.data_quality_issues
      where code = 'won_without_valid_price' and status = 'open'
    `;
    if (!issue) throw new Error("expected a won-without-price issue");
    await acceptQualityIssue(db, {
      issueId: issue.id,
      actorId: testUsers.admin.id,
      reason: "Сумма подтверждена вручную руководителем отдела",
    });

    const approved = await approveSnapshot(db, candidate.id);
    expect(approved.status).toBe("approved");
    // Freshness of the source is carried into the snapshot, not recomputed.
    expect(approved.sourceFreshAt.toISOString()).toBe("2026-10-05T09:30:00.000Z");
    await expect(getCurrentSnapshot(db)).resolves.toMatchObject({ id: candidate.id });

    const rows = await exportComparableRows(db, approved.id);
    const dailyWindow = rows.daily.filter(
      (row) => row.key >= "2026-09-05" && row.key <= "2026-09-09",
    );
    expect(dailyWindow).toEqual(
      comparable(goldenDailyRows, (row: { date: string }) => row.date),
    );
    expect(rows.managers).toEqual(
      comparable(goldenManagerRows, (row: { managerId: number | null }) =>
        row.managerId === null ? "unassigned" : String(row.managerId)),
    );
    expect(rows.channels).toEqual(
      comparable(goldenChannelRows, (row: { channel: string }) => row.channel),
    );
  });

  it("keeps quality evidence and drill-down facts free of personal data", async () => {
    const fixture = await seedAccount();
    await ingestGoldenRawDataset(fixture);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const candidate = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    const facts = await adminDb<{
      display_name: string; amo_url: string; quality_codes: string[];
    }[]>`
      select display_name, amo_url, quality_codes from public.metric_lead_facts
      where snapshot_id = ${candidate.id} order by amo_lead_id
    `;
    expect(facts).toHaveLength(11);
    for (const fact of facts) {
      expect(fact.display_name).not.toMatch(/\d{10}/);
      expect(fact.amo_url).toMatch(/^https:\/\/555151\.amocrm\.ru\/leads\/detail\/\d+$/);
    }
    const unknownChannelFact = await adminDb<{ quality_codes: string[] }[]>`
      select quality_codes from public.metric_lead_facts
      where snapshot_id = ${candidate.id} and amo_lead_id = 1007
    `;
    expect(unknownChannelFact[0]?.quality_codes).toContain("unknown_channel");
  });
});
