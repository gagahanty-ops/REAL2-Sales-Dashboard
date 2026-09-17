import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDbClient, createServiceWorkerDbClient } from "@real2/db";

import {
  createAdminDb,
  ensureRestrictedTestLogins,
  localServiceWorkerDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
  updateOwnNameAsManager,
  visibleAppUserIds,
  visibleControlKeys,
} from "../helpers/local-db";

const adminDb = createAdminDb();
const allUsers = Object.values(testUsers);

async function clearDatabaseFixtures(): Promise<void> {
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

beforeEach(async () => {
  await ensureRestrictedTestLogins(adminDb);
  await clearDatabaseFixtures();
  await resetAndSeedUsers(adminDb, allUsers);
  await adminDb`
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
      555151,
      '555151',
      'https://555151.amocrm.ru',
      ${Buffer.alloc(64)},
      ${Buffer.alloc(64)},
      '2026-09-12T13:00:00.000Z',
      'active',
      ${testUsers.admin.id}
    )
  `;
});

afterEach(async () => {
  await clearDatabaseFixtures();
});

afterAll(async () => {
  await adminDb.end();
});

describe("identity RLS deny-by-default rules", () => {
  it.each([testUsers.admin, testUsers.head])(
    "$role can read every application user",
    async (user) => {
      await expect(
        visibleAppUserIds(adminDb, "authenticated", user.authUserId),
      ).resolves.toHaveLength(allUsers.length);
    },
  );

  it("allows an active manager to read only their own row", async () => {
    await expect(
      visibleAppUserIds(
        adminDb,
        "authenticated",
        testUsers.managerOne.authUserId,
      ),
    ).resolves.toEqual([testUsers.managerOne.id]);
  });

  it("returns no rows for an inactive identity", async () => {
    await expect(
      visibleAppUserIds(
        adminDb,
        "authenticated",
        testUsers.inactiveManager.authUserId,
      ),
    ).resolves.toEqual([]);
  });

  it("does not grant anonymous access to application users", async () => {
    await expect(visibleAppUserIds(adminDb, "anon")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("lets leadership read controls but hides them from managers", async () => {
    await expect(
      visibleControlKeys(adminDb, testUsers.admin.authUserId),
    ).resolves.toEqual(["sheet_publish_enabled", "sync_enabled"]);
    await expect(
      visibleControlKeys(adminDb, testUsers.head.authUserId),
    ).resolves.toEqual(["sheet_publish_enabled", "sync_enabled"]);
    await expect(
      visibleControlKeys(adminDb, testUsers.managerOne.authUserId),
    ).resolves.toEqual([]);
  });

  it("does not allow a manager to update even their own row", async () => {
    await expect(
      updateOwnNameAsManager(adminDb, testUsers.managerOne),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("amoCRM credential RLS", () => {
  it("lets an admin read only the safe connection projection", async () => {
    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        return transaction<{
          account_id: string;
          subdomain: string;
          status: string;
        }[]>`
          select account_id, subdomain, status
          from public.amo_connections
        `;
      }),
    ).resolves.toEqual([
      { account_id: "555151", subdomain: "555151", status: "active" },
    ]);
  });

  it("does not grant user-facing roles token or OAuth-state access", async () => {
    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        await transaction`
          select access_token_ciphertext from public.amo_connections
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        await transaction`select state_hash from public.oauth_states`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("pipeline configuration RLS", () => {
  async function visibleConfigVersions(authUserId: string): Promise<number[]> {
    return adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config('request.jwt.claim.sub', ${authUserId}, true)
      `;
      const rows = await transaction<{ version: number }[]>`
        select version from public.pipeline_configs order by version
      `;
      return rows.map((row) => row.version);
    });
  }

  it("shows only the active safe projection to admin and head and hides it from managers", async () => {
    const [connection] = await adminDb<{ id: string }[]>`
      select id from public.amo_connections limit 1
    `;
    if (!connection) throw new Error("amoCRM fixture connection is missing");

    await adminDb`
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
      ) values
        (
          ${connection.id}, 10243278, 'РЕАЛ ДВА', 11,
          'Завершение (самовывоз или доставка)', 99,
          'Успешно реализовано', 77, 1, false, ${testUsers.admin.id}
        ),
        (
          ${connection.id}, 10243278, 'РЕАЛ ДВА', 11,
          'Завершение (самовывоз или доставка)', 99,
          'Успешно реализовано', 77, 2, true, ${testUsers.admin.id}
        )
    `;

    await expect(
      visibleConfigVersions(testUsers.admin.authUserId),
    ).resolves.toEqual([2]);
    await expect(
      visibleConfigVersions(testUsers.head.authUserId),
    ).resolves.toEqual([2]);
    await expect(
      visibleConfigVersions(testUsers.managerOne.authUserId),
    ).resolves.toEqual([]);
  });

  it("does not grant authenticated users direct writes to configuration history", async () => {
    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        await transaction`
          insert into public.pipeline_configs (
            amo_connection_id,
            pipeline_id,
            pipeline_name,
            application_status_id,
            application_status_name,
            won_status_id,
            won_status_name,
            version,
            confirmed_by
          ) select
            id, 10243278, 'РЕАЛ ДВА', 11,
            'Завершение (самовывоз или доставка)', 99,
            'Успешно реализовано', 1, ${testUsers.admin.id}
          from public.amo_connections
          limit 1
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("worker database scope", () => {
  it("connects as service_worker and cannot read application-user rows", async () => {
    const workerDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl);

    try {
      await expect(workerDb<{ current_user: string }[]>`
        select current_user
      `).resolves.toEqual([{ current_user: "service_worker" }]);
      await expect(workerDb`select id from public.app_users`).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await closeDbClient(workerDb);
    }
  });
});

describe("raw synchronization RLS", () => {
  async function seedRawJournal(): Promise<void> {
    const [connection] = await adminDb<{ id: string }[]>`
      select id from public.amo_connections limit 1
    `;
    if (!connection) throw new Error("amoCRM fixture connection is missing");
    const [config] = await adminDb<{ id: string }[]>`
      insert into public.pipeline_configs (
        amo_connection_id,
        pipeline_id,
        pipeline_name,
        application_status_id,
        application_status_name,
        won_status_id,
        won_status_name,
        version,
        is_active,
        confirmed_by
      ) values (
        ${connection.id}, 10243278, 'РЕАЛ ДВА', 11,
        'Завершение (самовывоз или доставка)', 99,
        'Успешно реализовано', 1, true, ${testUsers.admin.id}
      )
      returning id
    `;
    if (!config) throw new Error("pipeline fixture is missing");
    const [run] = await adminDb<{ id: string }[]>`
      insert into public.sync_runs (
        trace_id, connection_id, config_id, kind
      ) values (
        'trace-rls', ${connection.id}, ${config.id}, 'incremental'
      )
      returning id
    `;
    if (!run) throw new Error("sync run fixture is missing");
    await adminDb`
      insert into public.sync_pages (
        sync_run_id, stream, page_number, item_count, payload_sha256
      ) values (${run.id}, 'leads', 1, 1, ${"a".repeat(64)})
    `;
    await adminDb`
      insert into public.raw_amo_objects (
        sync_run_id, account_id, entity_type, external_id,
        payload, payload_sha256
      ) values (
        ${run.id}, 555151, 'lead', 7001,
        ${adminDb.json({ id: 7001, synthetic: true })}, ${"b".repeat(64)}
      )
    `;
    await adminDb`
      insert into public.raw_amo_events (
        sync_run_id, account_id, amo_event_id, amo_lead_id,
        event_type, event_at, payload, payload_sha256
      ) values (
        ${run.id}, 555151, '01pz58t6p04ymgsgfbmfyfy1mf', 7001,
        'lead_status_changed', '2026-09-15T09:00:30.000Z',
        ${adminDb.json({ id: "01pz58t6p04ymgsgfbmfyfy1mf", synthetic: true })},
        ${"c".repeat(64)}
      )
    `;
    await adminDb`
      insert into public.amo_api_audit (
        sync_run_id, trace_id, method, normalized_path,
        response_status, duration_ms, attempt, result
      ) values (
        ${run.id}, 'trace-rls', 'GET', '/api/v4/leads',
        200, 3, 1, 'success'
      )
    `;
    await adminDb`
      update public.sync_runs
      set status = 'success', finished_at = '2026-09-15T09:01:00.000Z'
      where id = ${run.id}
    `;
  }

  async function visibleJournalCounts(authUserId: string) {
    return adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config('request.jwt.claim.sub', ${authUserId}, true)
      `;
      const [counts] = await transaction<{
        runs: number;
        pages: number;
        audits: number;
        raw_objects: number;
        raw_events: number;
      }[]>`
        select
          (select count(*)::integer from public.sync_runs) as runs,
          (select count(*)::integer from public.sync_pages) as pages,
          (select count(*)::integer from public.amo_api_audit) as audits,
          (select count(*)::integer from public.raw_amo_objects) as raw_objects,
          (select count(*)::integer from public.raw_amo_events) as raw_events
      `;
      return counts;
    });
  }

  it("shows safe run evidence to leadership but raw payloads only to admin", async () => {
    await seedRawJournal();

    await expect(visibleJournalCounts(testUsers.admin.authUserId)).resolves.toEqual({
      runs: 1,
      pages: 1,
      audits: 1,
      raw_objects: 1,
      raw_events: 1,
    });
    await expect(visibleJournalCounts(testUsers.head.authUserId)).resolves.toEqual({
      runs: 1,
      pages: 1,
      audits: 1,
      raw_objects: 0,
      raw_events: 0,
    });
    await expect(
      visibleJournalCounts(testUsers.managerOne.authUserId),
    ).resolves.toEqual({
      runs: 0,
      pages: 0,
      audits: 0,
      raw_objects: 0,
      raw_events: 0,
    });
  });

  it("keeps cursors and direct writes unavailable to authenticated users", async () => {
    await seedRawJournal();

    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        await transaction`select stream from public.sync_cursors`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      adminDb.begin(async (transaction) => {
        await transaction.unsafe("set local role authenticated");
        await transaction`
          select set_config(
            'request.jwt.claim.sub',
            ${testUsers.admin.authUserId},
            true
          )
        `;
        await transaction`
          delete from public.raw_amo_objects where external_id = 7001
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies anonymous raw-event access and user execution of the finalizer", async () => {
    await seedRawJournal();
    await expect(adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role anon");
      await transaction`select amo_event_id from public.raw_amo_events`;
    })).rejects.toMatchObject({ code: "42501" });
    await expect(adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config('request.jwt.claim.sub', ${testUsers.admin.authUserId}, true)
      `;
      await transaction`
        select app.finish_sync_run(
          '00000000-0000-4000-8000-000000000001'::uuid,
          'success'::public.sync_status, now(), 0, 0, 0, 0, 0,
          null, null, null, null, '{}'::jsonb
        )
      `;
    })).rejects.toMatchObject({ code: "42501" });
    await expect(adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        update public.raw_amo_events set event_type = 'tampered'
      `;
    })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("normalized lead RLS", () => {
  async function seedNormalizedLeads(): Promise<void> {
    const [connection] = await adminDb<{ id: string }[]>`
      select id from public.amo_connections limit 1
    `;
    if (!connection) throw new Error("amoCRM fixture connection is missing");
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
      insert into public.amo_users (
        account_id, amo_user_id, name, email, is_active
      ) values (555151, 101, 'Manager One', 'manager.one@example.test', true)
    `;
    await adminDb`
      insert into public.pipeline_statuses (
        account_id, pipeline_id, status_id, name, sort_order, is_closed, is_won
      ) values (555151, 10, 20, 'Application', 1, false, false)
    `;
    await adminDb`
      insert into public.leads (
        account_id, amo_lead_id, pipeline_id, current_status_id,
        current_responsible_user_id, name, created_at, created_date,
        source_updated_at, normalized_channel, normalization_config_id, amo_url
      ) values
        (555151, 7001, 10, 20, 101, 'Manager One lead',
          '2026-09-15T09:00:00.000Z', '2026-09-15',
          '2026-09-15T09:01:00.000Z', 'site', ${config.id},
          'https://555151.amocrm.ru/leads/7001'),
        (555151, 7002, 10, 20, 102, 'Manager Two lead',
          '2026-09-15T09:00:00.000Z', '2026-09-15',
          '2026-09-15T09:01:00.000Z', 'site', ${config.id},
          'https://555151.amocrm.ru/leads/7002')
    `;
    await adminDb`
      insert into public.lead_stage_events (
        account_id, amo_event_id, amo_lead_id, to_status_id, occurred_at
      ) values
        (555151, 'stage-7001', 7001, 20, '2026-09-15T09:02:00.000Z'),
        (555151, 'stage-7002', 7002, 20, '2026-09-15T09:02:00.000Z')
    `;
    await adminDb`
      insert into public.lead_responsible_events (
        account_id, amo_event_id, amo_lead_id, to_user_id, occurred_at
      ) values
        (555151, 'responsible-7001', 7001, 101, '2026-09-15T09:03:00.000Z'),
        (555151, 'responsible-7002', 7002, 102, '2026-09-15T09:03:00.000Z')
    `;
    await adminDb`
      insert into public.lead_milestones (
        account_id, amo_lead_id, application_at, application_responsible_user_id
      ) values
        (555151, 7001, '2026-09-15T09:02:00.000Z', 101),
        (555151, 7002, '2026-09-15T09:02:00.000Z', 102)
    `;
    await adminDb`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity
      ) values (555151, 7001, 'missing_source', 'warning')
    `;
  }

  async function visibleNormalizedCounts(authUserId: string) {
    return adminDb.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config('request.jwt.claim.sub', ${authUserId}, true)
      `;
      const [counts] = await transaction<{
        users: number;
        statuses: number;
        leads: number;
        stage_events: number;
        responsible_events: number;
        milestones: number;
        quality_issues: number;
      }[]>`
        select
          (select count(*)::integer from public.amo_users) as users,
          (select count(*)::integer from public.pipeline_statuses) as statuses,
          (select count(*)::integer from public.leads) as leads,
          (select count(*)::integer from public.lead_stage_events) as stage_events,
          (select count(*)::integer from public.lead_responsible_events) as responsible_events,
          (select count(*)::integer from public.lead_milestones) as milestones,
          (select count(*)::integer from public.data_quality_issues) as quality_issues
      `;
      if (!counts) throw new Error("normalized counts are missing");
      return counts;
    });
  }

  it.each([testUsers.admin, testUsers.head])(
    "$role reads every normalized row",
    async (user) => {
      await seedNormalizedLeads();
      await expect(visibleNormalizedCounts(user.authUserId)).resolves.toEqual({
        users: 1,
        statuses: 1,
        leads: 2,
        stage_events: 2,
        responsible_events: 2,
        milestones: 2,
        quality_issues: 1,
      });
    },
  );

  it("limits a manager to assigned leads and their related history", async () => {
    await seedNormalizedLeads();
    await expect(
      visibleNormalizedCounts(testUsers.managerOne.authUserId),
    ).resolves.toEqual({
      users: 0,
      statuses: 0,
      leads: 1,
      stage_events: 1,
      responsible_events: 1,
      milestones: 1,
      quality_issues: 0,
    });
  });

  it("does not let the worker rewrite append-only normalized history", async () => {
    await seedNormalizedLeads();
    const workerDb = createServiceWorkerDbClient(localServiceWorkerDatabaseUrl);

    try {
      await expect(workerDb`
        update public.lead_stage_events
        set to_status_id = 999
        where account_id = 555151 and amo_event_id = 'stage-7001'
      `).rejects.toMatchObject({ code: "42501" });
      await expect(workerDb`
        update public.lead_responsible_events
        set to_user_id = 999
        where account_id = 555151 and amo_event_id = 'responsible-7001'
      `).rejects.toMatchObject({ code: "42501" });
    } finally {
      await closeDbClient(workerDb);
    }
  });
});
