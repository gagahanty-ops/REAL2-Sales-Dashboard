import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDbClient, createServiceWorkerDbClient } from "@real2/db";

import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
  updateOwnNameAsManager,
  visibleAppUserIds,
  visibleControlKeys,
} from "../helpers/local-db";

const adminDb = createAdminDb();
const allUsers = Object.values(testUsers);

async function clearDatabaseFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeEach(async () => {
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
    const workerDb = createServiceWorkerDbClient(localDatabaseUrl);

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
        trace_id, connection_id, config_id, kind, status, finished_at
      ) values (
        'trace-rls', ${connection.id}, ${config.id}, 'incremental',
        'success', '2026-09-15T09:01:00.000Z'
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
      insert into public.amo_api_audit (
        sync_run_id, trace_id, method, normalized_path,
        response_status, duration_ms, attempt, result
      ) values (
        ${run.id}, 'trace-rls', 'GET', '/api/v4/leads',
        200, 3, 1, 'success'
      )
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
      }[]>`
        select
          (select count(*)::integer from public.sync_runs) as runs,
          (select count(*)::integer from public.sync_pages) as pages,
          (select count(*)::integer from public.amo_api_audit) as audits,
          (select count(*)::integer from public.raw_amo_objects) as raw_objects
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
    });
    await expect(visibleJournalCounts(testUsers.head.authUserId)).resolves.toEqual({
      runs: 1,
      pages: 1,
      audits: 1,
      raw_objects: 0,
    });
    await expect(
      visibleJournalCounts(testUsers.managerOne.authUserId),
    ).resolves.toEqual({ runs: 0, pages: 0, audits: 0, raw_objects: 0 });
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
});
