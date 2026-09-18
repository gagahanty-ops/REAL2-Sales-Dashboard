import { createHash } from "node:crypto";

import {
  closeDbClient,
  createNormalizeRunRepository,
  createServiceWorkerDbClient,
  getActivePipelineConfig,
  type Database,
} from "@real2/db";
import {
  SYNTHETIC_APPLICATION_STATUS_ID,
  SYNTHETIC_LEAD_ACCOUNT_ID,
  SYNTHETIC_OPEN_STATUS_ID,
  SYNTHETIC_PIPELINE_ID,
  SYNTHETIC_SOURCE_FIELD_ID,
  SYNTHETIC_WON_STATUS_ID,
  buildRawLead,
} from "@real2/testkit";
import { AppError } from "@real2/domain";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAdminDb,
  ensureRestrictedTestLogins,
  localServiceWorkerDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../../tests/helpers/local-db";
import { normalizeSyncRun } from "./normalize-sync-run";

const adminDb = createAdminDb();
let workerDb: Database;

const ACCOUNT_ID = SYNTHETIC_LEAD_ACCOUNT_ID;
const LEAD_ID = 101;
const FIRST_USER_ID = 601;
const SECOND_USER_ID = 602;
const RUN_FINISHED_AT = new Date("2026-09-12T00:00:00.000Z");
const NORMALIZED_AT = new Date("2026-09-12T01:00:00.000Z");

type Fixture = Readonly<{ connectionId: string; configId: string; syncRunId: string }>;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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
      application_status_name, won_status_id, won_status_name, source_field_id,
      version, is_active, confirmed_by
    ) values (
      ${connection.id}, ${SYNTHETIC_PIPELINE_ID}, 'Synthetic',
      ${SYNTHETIC_APPLICATION_STATUS_ID}, 'Application', ${SYNTHETIC_WON_STATUS_ID},
      'Won', ${SYNTHETIC_SOURCE_FIELD_ID}, 1, true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing synthetic config");
  await adminDb`
    insert into public.channel_rules (
      config_id, priority, match_type, match_value, normalized_channel, created_by
    ) values (
      ${config.id}, 1, 'source_field_exact', 'Звонок', 'phone_uis', ${testUsers.admin.id}
    )
  `;
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
      ${`trace-${Date.now()}`}, ${connection.id}, ${config.id}, 'incremental',
      'running', '2026-09-11T23:00:00Z'
    ) returning id
  `;
  if (!run) throw new Error("missing synthetic sync run");
  return { connectionId: connection.id, configId: config.id, syncRunId: run.id };
}

/** Raw pages may only be appended while the run is still running. */
async function reopenRun(syncRunId: string): Promise<void> {
  await adminDb`
    update public.sync_runs set status = 'running', finished_at = null
    where id = ${syncRunId}
  `;
}

async function finishRun(syncRunId: string): Promise<void> {
  await adminDb`
    update public.sync_runs set status = 'success', finished_at = ${RUN_FINISHED_AT}
    where id = ${syncRunId}
  `;
}

async function insertRawObject(
  syncRunId: string,
  entityType: "lead" | "status" | "user",
  externalId: number,
  payload: unknown,
): Promise<void> {
  await adminDb`
    insert into public.raw_amo_objects (
      sync_run_id, account_id, entity_type, external_id, payload, payload_sha256
    ) values (
      ${syncRunId}, ${ACCOUNT_ID}, ${entityType}, ${externalId},
      ${adminDb.json(payload as never)}, ${sha256(payload)}
    )
    on conflict (sync_run_id, entity_type, external_id) do update set
      payload = excluded.payload, payload_sha256 = excluded.payload_sha256
  `;
}

async function insertRawEvent(
  syncRunId: string,
  amoEventId: string,
  eventType: string,
  eventAt: string,
  payload: unknown,
): Promise<void> {
  await adminDb`
    insert into public.raw_amo_events (
      sync_run_id, account_id, amo_event_id, amo_lead_id, event_type, event_at,
      payload, payload_sha256
    ) values (
      ${syncRunId}, ${ACCOUNT_ID}, ${amoEventId}, ${LEAD_ID}, ${eventType},
      ${eventAt}, ${adminDb.json(payload as never)}, ${sha256(payload)}
    )
    on conflict (account_id, amo_event_id) do nothing
  `;
}

function statusPayload(statusId: number, sort: number): Record<string, unknown> {
  return {
    id: statusId,
    name: `Status ${statusId}`,
    pipeline_id: SYNTHETIC_PIPELINE_ID,
    sort,
    account_id: ACCOUNT_ID,
  };
}

function stagePayload(
  toStatusId: number,
  fromStatusId: number | null,
): Record<string, unknown> {
  return {
    entity_type: "lead",
    entity_id: LEAD_ID,
    value_before:
      fromStatusId === null ? [] : [{ lead_status: { id: fromStatusId } }],
    value_after: [{ lead_status: { id: toStatusId } }],
  };
}

function responsiblePayload(
  toUserId: number,
  fromUserId: number | null,
): Record<string, unknown> {
  return {
    entity_type: "lead",
    entity_id: LEAD_ID,
    value_before: fromUserId === null ? [] : [{ responsible_user: { id: fromUserId } }],
    value_after: [{ responsible_user: { id: toUserId } }],
  };
}

async function seedPipelineMetadata(syncRunId: string): Promise<void> {
  await insertRawObject(syncRunId, "status", SYNTHETIC_OPEN_STATUS_ID,
    statusPayload(SYNTHETIC_OPEN_STATUS_ID, 10));
  await insertRawObject(syncRunId, "status", SYNTHETIC_APPLICATION_STATUS_ID,
    statusPayload(SYNTHETIC_APPLICATION_STATUS_ID, 20));
  await insertRawObject(syncRunId, "status", SYNTHETIC_WON_STATUS_ID,
    statusPayload(SYNTHETIC_WON_STATUS_ID, 30));
  await insertRawObject(syncRunId, "user", FIRST_USER_ID, {
    id: FIRST_USER_ID,
    name: "Synthetic manager one",
    rights: { is_active: true },
  });
  await insertRawObject(syncRunId, "user", SECOND_USER_ID, {
    id: SECOND_USER_ID,
    name: "Synthetic manager two",
    rights: { is_active: false },
  });
}

function buildDeps(): Parameters<typeof normalizeSyncRun>[0] {
  return {
    repository: createNormalizeRunRepository(workerDb),
    loadActiveConfig: (connectionId) => getActivePipelineConfig(workerDb, connectionId),
    now: () => NORMALIZED_AT,
  };
}

async function readDerivedRows(): Promise<{
  leads: unknown[];
  stageEvents: unknown[];
  responsibleEvents: unknown[];
  milestones: unknown[];
}> {
  const [leads, stageEvents, responsibleEvents, milestones] = await Promise.all([
    adminDb`select * from public.leads order by amo_lead_id`,
    adminDb`select * from public.lead_stage_events order by occurred_at, amo_event_id`,
    adminDb`select * from public.lead_responsible_events order by occurred_at, amo_event_id`,
    adminDb`select * from public.lead_milestones order by amo_lead_id`,
  ]);
  return {
    leads: [...leads],
    stageEvents: [...stageEvents],
    responsibleEvents: [...responsibleEvents],
    milestones: [...milestones],
  };
}

function withoutNormalizedAt(leads: readonly unknown[]): unknown[] {
  return leads.map((lead) => {
    const rest = { ...(lead as Record<string, unknown>) };
    delete rest.normalized_at;
    return rest;
  });
}

function normalizedAtOf(leads: readonly unknown[]): Date {
  const [lead] = leads as { normalized_at: Date }[];
  if (!lead) throw new Error("normalized lead row is missing");
  return lead.normalized_at;
}

async function openIssueCodes(): Promise<readonly string[]> {
  const rows = await adminDb<{ code: string }[]>`
    select code from public.data_quality_issues where status = 'open' order by code
  `;
  return rows.map((row) => row.code);
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeAll(async () => {
  await ensureRestrictedTestLogins(adminDb);
  workerDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl, { max: 2 });
});

beforeEach(clearFixtures);
afterEach(clearFixtures);
afterAll(async () => {
  await Promise.all([closeDbClient(workerDb), closeDbClient(adminDb)]);
});

describe("normalizeSyncRun", () => {
  it("writes the snapshot, its ordered history and the derived milestones", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(
      fixture.syncRunId,
      "lead",
      LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_WON_STATUS_ID, responsibleUserId: SECOND_USER_ID }),
    );
    await insertRawEvent(fixture.syncRunId, "evt-2", "lead_status_changed",
      "2026-09-08T09:00:00Z",
      stagePayload(SYNTHETIC_APPLICATION_STATUS_ID, SYNTHETIC_OPEN_STATUS_ID));
    await insertRawEvent(fixture.syncRunId, "evt-1", "entity_responsible_changed",
      "2026-09-07T09:00:00Z", responsiblePayload(SECOND_USER_ID, FIRST_USER_ID));
    await insertRawEvent(fixture.syncRunId, "evt-3", "lead_status_changed",
      "2026-09-09T09:00:00Z",
      stagePayload(SYNTHETIC_WON_STATUS_ID, SYNTHETIC_APPLICATION_STATUS_ID));
    await insertRawEvent(fixture.syncRunId, "evt-4", "lead_note_added",
      "2026-09-09T10:00:00Z", { entity_type: "lead" });

    await finishRun(fixture.syncRunId);
    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.leadsNormalized).toBe(1);
    expect(result.leadsRejected).toBe(0);
    expect(result.stageEventsWritten).toBe(2);
    expect(result.responsibleEventsWritten).toBe(1);
    expect(result.malformedEvents).toBe(0);

    const rows = await readDerivedRows();
    expect(rows.leads).toHaveLength(1);
    expect(rows.leads[0]).toMatchObject({
      account_id: String(ACCOUNT_ID),
      amo_lead_id: String(LEAD_ID),
      current_status_id: String(SYNTHETIC_WON_STATUS_ID),
      current_responsible_user_id: String(SECOND_USER_ID),
      normalized_channel: "phone_uis",
      amo_url: `https://555151.amocrm.ru/leads/detail/${LEAD_ID}`,
    });
    expect(
      rows.stageEvents.map((row) => (row as { amo_event_id: string }).amo_event_id),
    ).toEqual(["evt-2", "evt-3"]);
    expect(rows.stageEvents.map(
      (row) => (row as { responsible_user_id: string }).responsible_user_id,
    )).toEqual([String(SECOND_USER_ID), String(SECOND_USER_ID)]);
    expect(rows.milestones[0]).toMatchObject({
      application_at: new Date("2026-09-08T09:00:00.000Z"),
      application_responsible_user_id: String(SECOND_USER_ID),
      won_at: new Date("2026-09-09T09:00:00.000Z"),
      won_responsible_user_id: String(SECOND_USER_ID),
      currently_won: true,
    });
    expect(await openIssueCodes()).toEqual([]);

    const statuses = await adminDb<{ status_id: string; is_won: boolean }[]>`
      select status_id, is_won from public.pipeline_statuses order by status_id
    `;
    expect(statuses.map((row) => row.is_won)).toEqual([false, false, true]);
    const users = await adminDb<{ is_active: boolean }[]>`
      select is_active from public.amo_users order by amo_user_id
    `;
    expect(users.map((row) => row.is_active)).toEqual([true, false]);
  });

  it("keeps derived rows byte-equivalent when the same run is normalized twice", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_APPLICATION_STATUS_ID, responsibleUserId: FIRST_USER_ID }));
    await insertRawEvent(fixture.syncRunId, "evt-1", "lead_status_changed",
      "2026-09-08T09:00:00Z",
      stagePayload(SYNTHETIC_APPLICATION_STATUS_ID, SYNTHETIC_OPEN_STATUS_ID));

    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const first = await readDerivedRows();
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const second = await readDerivedRows();

    // Derived rows must be identical, row identities included. Only the
    // processing stamp `leads.normalized_at` is allowed to move forward.
    expect(second.stageEvents).toEqual(first.stageEvents);
    expect(second.responsibleEvents).toEqual(first.responsibleEvents);
    expect(second.milestones).toEqual(first.milestones);
    expect(withoutNormalizedAt(second.leads)).toEqual(withoutNormalizedAt(first.leads));
    expect(normalizedAtOf(second.leads) > normalizedAtOf(first.leads)).toBe(true);
  });

  it("keeps stage history append-only and recalculates the milestone after a late handover", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_APPLICATION_STATUS_ID, responsibleUserId: FIRST_USER_ID }));
    await insertRawEvent(fixture.syncRunId, "evt-2", "lead_status_changed",
      "2026-09-08T09:00:00Z",
      stagePayload(SYNTHETIC_APPLICATION_STATUS_ID, SYNTHETIC_OPEN_STATUS_ID));

    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const [before] = await adminDb<{ responsible_user_id: string; id: string }[]>`
      select id, responsible_user_id from public.lead_stage_events
    `;
    expect(before?.responsible_user_id).toBe(String(FIRST_USER_ID));

    await reopenRun(fixture.syncRunId);
    await insertRawEvent(fixture.syncRunId, "evt-1", "entity_responsible_changed",
      "2026-09-07T09:00:00Z", responsiblePayload(SECOND_USER_ID, FIRST_USER_ID));
    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    const [after] = await adminDb<{ responsible_user_id: string; id: string }[]>`
      select id, responsible_user_id from public.lead_stage_events
    `;
    // The stage row is an audit record and is never rewritten; the milestone is
    // the recalculated attribution and does follow the late handover.
    expect(after?.id).toBe(before?.id);
    expect(after?.responsible_user_id).toBe(String(FIRST_USER_ID));
    const [milestone] = await adminDb<{ application_responsible_user_id: string }[]>`
      select application_responsible_user_id from public.lead_milestones
    `;
    expect(milestone?.application_responsible_user_id).toBe(String(SECOND_USER_ID));
    const [responsible] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.lead_responsible_events
    `;
    expect(responsible?.count).toBe(1);
  });

  it("opens missing_stage_history when the snapshot claims a milestone no event proves", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_WON_STATUS_ID, responsibleUserId: FIRST_USER_ID }));

    await finishRun(fixture.syncRunId);
    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.leadsNormalized).toBe(1);
    expect(await openIssueCodes()).toContain("missing_stage_history");
    const [milestone] = await adminDb<{ won_at: Date | null; currently_won: boolean }[]>`
      select won_at, currently_won from public.lead_milestones
    `;
    expect(milestone?.won_at).toBeNull();
    expect(milestone?.currently_won).toBe(true);
  });

  it("reports a history event whose payload cannot be read", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID, buildRawLead());
    await insertRawEvent(fixture.syncRunId, "evt-1", "lead_status_changed",
      "2026-09-08T09:00:00Z", { entity_type: "lead", value_after: [] });

    await finishRun(fixture.syncRunId);
    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.malformedEvents).toBe(1);
    expect(await openIssueCodes()).toContain("malformed_event_payload");
  });

  it("escalates a stored lead that left the configured pipeline instead of deleting it", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_APPLICATION_STATUS_ID }));
    await insertRawEvent(fixture.syncRunId, "evt-1", "lead_status_changed",
      "2026-09-08T09:00:00Z",
      stagePayload(SYNTHETIC_APPLICATION_STATUS_ID, SYNTHETIC_OPEN_STATUS_ID));
    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    expect((await readDerivedRows()).leads).toHaveLength(1);

    await reopenRun(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ pipelineId: SYNTHETIC_PIPELINE_ID + 11 }));
    await finishRun(fixture.syncRunId);
    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.leadsExcluded).toBe(1);
    expect(result.leadsOutOfScope).toBe(1);
    // Nothing is deleted from the normalized layer (METRICS_CATALOG section 11).
    const rows = await readDerivedRows();
    expect(rows.leads).toHaveLength(1);
    expect(rows.stageEvents).toHaveLength(1);
    expect(rows.milestones).toHaveLength(1);
    const [issue] = await adminDb<{ severity: string; safe_details: unknown }[]>`
      select severity, safe_details from public.data_quality_issues
      where code = 'out_of_scope_pipeline' and status = 'open'
    `;
    expect(issue?.severity).toBe("blocking");
    expect(issue?.safe_details).toMatchObject({ stored: 1 });
    const [raw] = await adminDb<{ count: number }[]>`
      select count(*)::integer as count from public.raw_amo_objects
      where entity_type = 'lead'
    `;
    expect(raw?.count).toBe(1);
  });

  it("leaves a never-stored out-of-scope lead unwritten with a warning issue", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ pipelineId: SYNTHETIC_PIPELINE_ID + 11 }));
    await finishRun(fixture.syncRunId);

    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.leadsNormalized).toBe(0);
    expect(result.leadsOutOfScope).toBe(0);
    expect((await readDerivedRows()).leads).toEqual([]);
    const [issue] = await adminDb<{ severity: string }[]>`
      select severity from public.data_quality_issues
      where code = 'out_of_scope_pipeline' and status = 'open'
    `;
    expect(issue?.severity).toBe("warning");
  });

  it("leaves previously normalized rows intact when the transaction fails", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_APPLICATION_STATUS_ID }));
    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    const before = await readDerivedRows();

    const repository = createNormalizeRunRepository(workerDb);
    const [stored] = before.leads as { amo_lead_id: string }[];
    expect(stored).toBeDefined();
    await expect(
      repository.apply({
        amoUsers: [],
        pipelineStatuses: [],
        leads: [
          {
            lead: {
              accountId: ACCOUNT_ID,
              amoLeadId: LEAD_ID + 1,
              pipelineId: SYNTHETIC_PIPELINE_ID,
              currentStatusId: SYNTHETIC_OPEN_STATUS_ID,
              currentResponsibleUserId: FIRST_USER_ID,
              name: "Second synthetic lead",
              priceRub: "1000.00",
              createdAt: new Date("2026-09-05T09:00:00Z"),
              createdDate: "2026-09-05",
              sourceUpdatedAt: new Date("2026-09-06T09:00:00Z"),
              normalizedChannel: "phone_uis",
              channelRuleId: null,
              normalizationConfigId: fixture.configId,
              amoUrl: `https://555151.amocrm.ru/leads/detail/${LEAD_ID + 1}`,
              isDeleted: false,
            },
            stageEvents: [],
            responsibleEvents: [],
            milestone: {
              accountId: ACCOUNT_ID,
              amoLeadId: LEAD_ID + 1,
              applicationAt: null,
              applicationResponsibleUserId: null,
              wonAt: null,
              wonResponsibleUserId: null,
              currentlyWon: false,
            },
          },
          {
            lead: {
              accountId: ACCOUNT_ID,
              amoLeadId: LEAD_ID + 2,
              pipelineId: SYNTHETIC_PIPELINE_ID,
              currentStatusId: SYNTHETIC_OPEN_STATUS_ID,
              currentResponsibleUserId: null,
              name: "Invalid price lead",
              priceRub: "not-a-price",
              createdAt: new Date("2026-09-05T09:00:00Z"),
              createdDate: "2026-09-05",
              sourceUpdatedAt: new Date("2026-09-06T09:00:00Z"),
              normalizedChannel: "phone_uis",
              channelRuleId: null,
              normalizationConfigId: fixture.configId,
              amoUrl: `https://555151.amocrm.ru/leads/detail/${LEAD_ID + 2}`,
              isDeleted: false,
            },
            stageEvents: [],
            responsibleEvents: [],
            milestone: {
              accountId: ACCOUNT_ID,
              amoLeadId: LEAD_ID + 2,
              applicationAt: null,
              applicationResponsibleUserId: null,
              wonAt: null,
              wonResponsibleUserId: null,
              currentlyWon: false,
            },
          },
        ],
        removedLeads: [],
        issues: [],
      }),
    ).rejects.toThrow(AppError);

    expect(await readDerivedRows()).toEqual(before);
  });

  it("resolves an issue that stopped appearing and keeps issues of other leads", async () => {
    const fixture = await seedFixture();
    await seedPipelineMetadata(fixture.syncRunId);
    await insertRawObject(fixture.syncRunId, "lead", LEAD_ID,
      buildRawLead({ statusId: SYNTHETIC_WON_STATUS_ID, responsibleUserId: FIRST_USER_ID }));
    await finishRun(fixture.syncRunId);
    await normalizeSyncRun(buildDeps(), fixture.syncRunId);
    expect(await openIssueCodes()).toContain("missing_stage_history");

    // An issue of a lead this run never observed must survive untouched.
    await adminDb`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity, status
      ) values (${ACCOUNT_ID}, ${LEAD_ID + 50}, 'unknown_channel', 'warning', 'open')
    `;

    await reopenRun(fixture.syncRunId);
    await insertRawEvent(fixture.syncRunId, "evt-1", "lead_status_changed",
      "2026-09-08T09:00:00Z",
      stagePayload(SYNTHETIC_APPLICATION_STATUS_ID, SYNTHETIC_OPEN_STATUS_ID));
    await insertRawEvent(fixture.syncRunId, "evt-2", "lead_status_changed",
      "2026-09-09T09:00:00Z",
      stagePayload(SYNTHETIC_WON_STATUS_ID, SYNTHETIC_APPLICATION_STATUS_ID));
    await finishRun(fixture.syncRunId);
    const result = await normalizeSyncRun(buildDeps(), fixture.syncRunId);

    expect(result.issuesResolved).toBe(1);
    const rows = await adminDb<{ amo_lead_id: string; code: string; status: string }[]>`
      select amo_lead_id, code, status from public.data_quality_issues
      order by amo_lead_id
    `;
    expect(rows).toEqual([
      { amo_lead_id: String(LEAD_ID), code: "missing_stage_history", status: "resolved" },
      { amo_lead_id: String(LEAD_ID + 50), code: "unknown_channel", status: "open" },
    ]);
  });

  it("refuses to normalize a run that did not succeed", async () => {
    const fixture = await seedFixture();
    await adminDb`
      update public.sync_runs
      set status = 'failed', finished_at = ${RUN_FINISHED_AT}
      where id = ${fixture.syncRunId}
    `;

    await expect(normalizeSyncRun(buildDeps(), fixture.syncRunId)).rejects.toThrow(
      AppError,
    );
  });

  it("refuses an unknown run", async () => {
    await seedFixture();

    await expect(
      normalizeSyncRun(buildDeps(), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(AppError);
  });
});
