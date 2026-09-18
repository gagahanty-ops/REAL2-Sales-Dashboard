import { createHash } from "node:crypto";

import {
  closeDbClient,
  createDbClient,
  createNormalizeRunRepository,
  exportComparableRows,
  getActivePipelineConfig,
  type Database,
} from "@real2/db";
import {
  GOLDEN_ACCOUNT_ID,
  GOLDEN_APPLICATION_STATUS_ID,
  GOLDEN_CHANNEL_RULES,
  GOLDEN_PIPELINE_ID,
  GOLDEN_SOURCE_FIELD_ID,
  GOLDEN_WON_STATUS_ID,
  goldenRawEvents,
  goldenRawLeads,
  goldenRawStatuses,
  goldenRawUsers,
  goldenRepeatedEvents,
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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function seedGoldenRun(): Promise<Readonly<{ syncRunId: string; configId: string }>> {
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
      ${`golden-idempotency-${Date.now()}`}, ${connection.id}, ${config.id},
      'initial_backfill', 'running', '2026-10-05T09:00:00Z'
    ) returning id
  `;
  if (!run) throw new Error("missing golden run");

  for (const object of [...goldenRawStatuses, ...goldenRawUsers, ...goldenRawLeads]) {
    await adminDb`
      insert into public.raw_amo_objects (
        sync_run_id, account_id, entity_type, external_id, source_updated_at,
        payload, payload_sha256
      ) values (
        ${run.id}, ${GOLDEN_ACCOUNT_ID}, ${object.entityType}, ${object.externalId},
        ${object.sourceUpdatedAt}, ${adminDb.json(object.payload as never)},
        ${sha256(object.payload)}
      )
      on conflict (sync_run_id, entity_type, external_id) do nothing
    `;
  }
  for (const event of [...goldenRawEvents, ...goldenRepeatedEvents]) {
    await adminDb`
      insert into public.raw_amo_events (
        sync_run_id, account_id, amo_event_id, amo_lead_id, event_type, event_at,
        payload, payload_sha256
      ) values (
        ${run.id}, ${GOLDEN_ACCOUNT_ID}, ${event.amoEventId}, ${event.amoLeadId},
        ${event.eventType}, ${event.eventAt}, ${adminDb.json(event.payload as never)},
        ${sha256(event.payload)}
      )
      on conflict (account_id, amo_event_id) do nothing
    `;
  }
  await adminDb`
    update public.sync_runs
    set status = 'success', finished_at = '2026-10-05T10:00:00Z',
      source_max_updated_at = '2026-10-05T09:30:00Z'
    where id = ${run.id}
  `;
  return { syncRunId: run.id, configId: config.id };
}

function buildDeps() {
  return {
    repository: createNormalizeRunRepository(db),
    loadActiveConfig: (connectionId: string) => getActivePipelineConfig(db, connectionId),
  };
}

async function rowCounts(): Promise<Record<string, number>> {
  const [counts] = await adminDb<Record<string, number>[]>`
    select
      (select count(*)::integer from public.raw_amo_objects) as raw_objects,
      (select count(*)::integer from public.raw_amo_events) as raw_events,
      (select count(*)::integer from public.leads) as leads,
      (select count(*)::integer from public.lead_stage_events) as stage_events,
      (select count(*)::integer from public.lead_milestones) as milestones,
      (select count(*)::integer from public.metric_snapshots) as snapshots,
      (select count(*)::integer from public.metric_cells) as cells,
      (select count(*)::integer from public.metric_lead_facts) as facts
  `;
  if (!counts) throw new Error("row counts are missing");
  return counts;
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

describe("repeating the pipeline changes nothing", () => {
  it("produces the same checksum and adds no rows on a second execution", async () => {
    const fixture = await seedGoldenRun();

    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const first = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);
    const countsAfterFirst = await rowCounts();
    const rowsAfterFirst = await exportComparableRows(db, first.id);

    const secondNormalization = await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const second = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    expect(second.id).toBe(first.id);
    expect(second.checksum).toBe(first.checksum);
    expect(await rowCounts()).toEqual(countsAfterFirst);
    expect(await exportComparableRows(db, second.id)).toEqual(rowsAfterFirst);
    expect(secondNormalization.leadsNormalized).toBe(11);
    expect(secondNormalization.issuesResolved).toBe(0);
  });

  it("measures stage age against the source freshness, not the wall clock", async () => {
    const fixture = await seedGoldenRun();
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const snapshot = await buildMetricSnapshot({ db }, fixture.syncRunId, fixture.configId);

    // Manager 8 holds three open leads in the first status; only lead 1005 has
    // a stage event, entered 2026-09-09T08:00:00Z, and the run's data was true
    // at 2026-10-05T09:30:00Z, which is exactly 2 251 800 seconds later.
    const [row] = await adminDb<{
      open_count: number; median_age_seconds: string; average_age_seconds: string;
    }[]>`
      select open_count, median_age_seconds, average_age_seconds
      from public.stage_snapshot_rows
      where snapshot_id = ${snapshot.id} and status_id = 770 and manager_key = '8'
    `;
    expect(row?.open_count).toBe(3);
    expect(Number(row?.median_age_seconds)).toBe(2_251_800);
    expect(Number(row?.average_age_seconds)).toBe(2_251_800);
  });

  it("deduplicates a repeated raw event instead of counting it twice", async () => {
    expect(goldenRepeatedEvents.length).toBeGreaterThan(0);
    const fixture = await seedGoldenRun();

    const [raw] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.raw_amo_events
    `;
    expect(raw?.count).toBe(goldenRawEvents.length);

    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const [stage] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.lead_stage_events
      where amo_lead_id = 1009
    `;
    expect(stage?.count).toBe(2);
  });

  it("keeps derived history stable when the same events arrive again", async () => {
    const fixture = await seedGoldenRun();
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const before = await adminDb`
      select amo_event_id, amo_lead_id, from_status_id, to_status_id, occurred_at
      from public.lead_stage_events order by amo_event_id
    `;

    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const after = await adminDb`
      select amo_event_id, amo_lead_id, from_status_id, to_status_id, occurred_at
      from public.lead_stage_events order by amo_event_id
    `;

    expect([...after]).toEqual([...before]);
  });
});
