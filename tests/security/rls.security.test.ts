import { afterAll, beforeEach, describe, expect, it } from "vitest";

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

beforeEach(async () => {
  await adminDb.unsafe(
    "truncate table public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
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
