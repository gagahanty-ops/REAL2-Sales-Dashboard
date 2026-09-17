import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createNormalizedLeadRepository } from "./leads";
import { createQualityRepository } from "./quality";
import {
  createAdminDb,
  ensureRestrictedTestLogins,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
const fixtureConfig = {
  accountId: 1,
  amoLeadId: 55,
  amoEventId: "01pz58t6p04ymgsgfbmfyfy1mf",
} as const;

async function clearFixture(): Promise<void> {
  await adminDb.unsafe(`
    do $$
    begin
      if to_regclass('public.data_quality_issues') is not null then
        execute 'truncate table public.data_quality_issues, public.lead_milestones,
          public.lead_responsible_events, public.lead_stage_events, public.leads,
          public.pipeline_statuses, public.amo_users, public.amo_api_audit,
          public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects,
          public.sync_pages, public.sync_cursors, public.sync_runs,
          public.config_recalculation_requests, public.config_validations,
          public.channel_rules, public.pipeline_configs';
      else
        execute 'truncate table public.amo_api_audit, public.raw_amo_quarantine,
          public.raw_amo_events, public.raw_amo_objects, public.sync_pages,
          public.sync_cursors, public.sync_runs, public.config_recalculation_requests,
          public.config_validations, public.channel_rules, public.pipeline_configs';
      end if;
    end
    $$;
  `);
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

async function seedNormalizedLead(): Promise<string> {
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      ${fixtureConfig.accountId}, '555151', 'https://555151.amocrm.ru',
      ${Buffer.alloc(64)}, ${Buffer.alloc(64)}, '2030-01-01T00:00:00.000Z',
      'active', ${testUsers.admin.id}
    ) returning id
  `;
  if (!connection) throw new Error("amoCRM connection fixture is missing");
  const [config] = await adminDb<{ id: string }[]>`
    insert into public.pipeline_configs (
      amo_connection_id, pipeline_id, pipeline_name, application_status_id,
      application_status_name, won_status_id, won_status_name, version,
      is_active, confirmed_by
    ) values (
      ${connection.id}, 10, 'Pipeline', 20, 'Application', 30, 'Won', 1,
      true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("pipeline configuration fixture is missing");
  await adminDb`
    insert into public.leads (
      account_id, amo_lead_id, pipeline_id, current_status_id,
      current_responsible_user_id, name, price_rub, created_at, created_date,
      source_updated_at, normalized_channel, normalization_config_id, amo_url
    ) values (
      ${fixtureConfig.accountId}, ${fixtureConfig.amoLeadId}, 10, 20, 101,
      'Synthetic lead', 5000, '2026-09-15T09:00:00.000Z', '2026-09-15',
      '2026-09-15T09:01:00.000Z', 'site', ${config.id},
      'https://555151.amocrm.ru/leads/55'
    )
  `;
  return config.id;
}

async function openIssue(): Promise<void> {
  await adminDb`
    insert into public.data_quality_issues (
      account_id, amo_lead_id, code, severity, status
    ) values (1, 55, 'missing_responsible', 'warning', 'open')
    on conflict (account_id, (coalesce(amo_lead_id, 0)), code)
      where status = 'open'
    do update set last_seen_at = excluded.last_seen_at
  `;
}

async function countOpenIssues(): Promise<number> {
  const [row] = await adminDb<{ count: number }[]>`
    select count(*)::integer as count
    from public.data_quality_issues
    where account_id = 1
      and amo_lead_id = 55
      and code = 'missing_responsible'
      and status = 'open'
  `;
  if (!row) throw new Error("quality issue count is missing");
  return row.count;
}

beforeAll(async () => {
  await ensureRestrictedTestLogins(adminDb);
});

beforeEach(async () => {
  await clearFixture();
});

afterEach(async () => {
  await clearFixture();
});

afterAll(async () => {
  await adminDb.end();
});

describe("normalized lead database invariants", () => {
  it("rejects a stage event for a lead in another amo account", async () => {
    await seedNormalizedLead();

    await expect(adminDb`
      insert into public.lead_stage_events (
        account_id, amo_event_id, amo_lead_id, to_status_id, occurred_at
      ) values (2, ${fixtureConfig.amoEventId}, 55, 20, '2026-09-15T09:02:00.000Z')
    `).rejects.toThrow(/foreign key/i);
  });

  it("allows only one open quality issue per lead and code", async () => {
    await seedNormalizedLead();

    await openIssue();
    await openIssue();

    await expect(countOpenIssues()).resolves.toBe(1);
  });

  it("persists normalized lead history and reopens a matching quality issue once", async () => {
    const configId = await seedNormalizedLead();
    const leads = createNormalizedLeadRepository(adminDb);
    const quality = createQualityRepository(adminDb);

    await leads.upsertAmoUser({
      accountId: 1,
      amoUserId: 101,
      name: "Manager One",
      email: "manager.one@example.test",
      isActive: true,
      sourceUpdatedAt: new Date("2026-09-15T09:01:00.000Z"),
    });
    await leads.upsertPipelineStatus({
      accountId: 1,
      pipelineId: 10,
      statusId: 20,
      name: "Application",
      sortOrder: 1,
      isClosed: false,
      isWon: false,
      sourceUpdatedAt: new Date("2026-09-15T09:01:00.000Z"),
    });
    await leads.upsertLead({
      accountId: 1,
      amoLeadId: 55,
      pipelineId: 10,
      currentStatusId: 20,
      currentResponsibleUserId: 101,
      name: "Synthetic lead",
      priceRub: 5000,
      createdAt: new Date("2026-09-15T09:00:00.000Z"),
      createdDate: "2026-09-15",
      sourceUpdatedAt: new Date("2026-09-15T09:01:00.000Z"),
      normalizedChannel: "site",
      channelRuleId: null,
      normalizationConfigId: configId,
      amoUrl: "https://555151.amocrm.ru/leads/55",
      isDeleted: false,
    });
    await leads.appendStageEvent({
      accountId: 1,
      amoEventId: "stage-event-55",
      amoLeadId: 55,
      fromStatusId: null,
      toStatusId: 20,
      responsibleUserId: 101,
      occurredAt: new Date("2026-09-15T09:02:00.000Z"),
    });
    await leads.appendResponsibleEvent({
      accountId: 1,
      amoEventId: "responsible-event-55",
      amoLeadId: 55,
      fromUserId: null,
      toUserId: 101,
      occurredAt: new Date("2026-09-15T09:03:00.000Z"),
    });
    await leads.upsertMilestone({
      accountId: 1,
      amoLeadId: 55,
      applicationAt: new Date("2026-09-15T09:02:00.000Z"),
      applicationResponsibleUserId: 101,
      wonAt: null,
      wonResponsibleUserId: null,
      currentlyWon: false,
    });
    const issueFixture = {
      accountId: 1,
      amoLeadId: 55,
      code: "missing_responsible",
      severity: "warning" as const,
      safeDetails: { source: "synthetic" },
    };
    await quality.open(issueFixture);
    await quality.open(issueFixture);

    await expect(adminDb<{
      users: number;
      statuses: number;
      stageEvents: number;
      responsibleEvents: number;
      milestones: number;
    }[]>`
      select
        (select count(*)::integer from public.amo_users) as users,
        (select count(*)::integer from public.pipeline_statuses) as statuses,
        (select count(*)::integer from public.lead_stage_events) as "stageEvents",
        (select count(*)::integer from public.lead_responsible_events) as "responsibleEvents",
        (select count(*)::integer from public.lead_milestones) as milestones
    `).resolves.toEqual([{
      users: 1,
      statuses: 1,
      stageEvents: 1,
      responsibleEvents: 1,
      milestones: 1,
    }]);
    await expect(quality.countOpen({ accountId: 1, amoLeadId: 55 }, "missing_responsible"))
      .resolves.toBe(1);
  });
});
