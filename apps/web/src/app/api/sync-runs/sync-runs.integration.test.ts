import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { finishSyncRun, startSyncRun } from "@real2/db";
import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../tests/helpers/local-db";

import { GET, POST } from "./route";
import { GET as GET_DETAIL } from "./[id]/route";

const adminDb = createAdminDb();
const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null,
  },
}));

vi.mock("../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({ APP_URL: "https://dashboard.example.test" }),
}));

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

async function seedRun(startedAt: Date) {
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      9001, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
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
      ${connection.id}, 77, 'Synthetic', 771, 'Application', 772, 'Won', 1,
      true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing synthetic config");
  const run = await startSyncRun(adminDb, {
    traceId: `safe-trace-${startedAt.getTime()}`,
    connectionId: connection.id,
    configId: config.id,
    kind: "incremental",
    createdBy: testUsers.admin.id,
    startedAt,
  });
  await adminDb`
    insert into public.amo_api_audit (
      sync_run_id, trace_id, method, normalized_path, response_status,
      duration_ms, attempt, result
    ) values (
      ${run.id}, ${run.traceId}, 'GET', '/api/v4/leads/12345', 200, 8, 1, 'success'
    )
  `;
  await finishSyncRun(adminDb, run.id, {
    status: "success",
    counts: { pagesRead: 2, leadsRead: 3, eventsRead: 4, usersRead: 1, retries: 1 },
    nextCursors: {},
  }, new Date(startedAt.getTime() + 1_000));
  return run;
}

beforeEach(async () => {
  await clearFixtures();
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
  session.user.id = testUsers.admin.id;
  session.user.role = "admin";
});
afterEach(clearFixtures);
afterAll(async () => adminDb.end());

describe("safe synchronization routes", () => {
  it.each(["admin", "head"] as const)("lets %s list and inspect safe run data", async (role) => {
    session.user.role = role;
    session.user.id = role === "admin" ? testUsers.admin.id : testUsers.head.id;
    const run = await seedRun(new Date("2026-09-15T08:00:00.000Z"));

    const list = await GET(new Request("https://dashboard.example.test/api/sync-runs?page=1"));
    const detail = await GET_DETAIL(
      new Request(`https://dashboard.example.test/api/sync-runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(list.status).toBe(200);
    expect((await list.json()).data.items[0]).toMatchObject({
      id: run.id,
      status: "success",
      counts: { pages: 2, leads: 3, events: 4, users: 1, retries: 1 },
    });
    const detailBody = await detail.json();
    expect(detailBody.data.audit[0]).toMatchObject({
      normalizedPath: "/api/v4/leads/:id",
      requestCount: 1,
    });
    expect(JSON.stringify(detailBody)).not.toContain("12345");
  });

  it("denies manager status access", async () => {
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    expect((await GET(new Request("https://dashboard.example.test/api/sync-runs"))).status).toBe(403);
  });

  it("requires recent-run confirmation, then durably queues an admin manual run", async () => {
    await seedRun(new Date(Date.now() - 30_000));
    const first = await POST(new Request("https://dashboard.example.test/api/sync-runs", {
      method: "POST",
      headers: { origin: "https://dashboard.example.test", "content-type": "application/json" },
      body: JSON.stringify({ confirmRecent: false }),
    }));
    expect(first.status).toBe(409);

    const accepted = await POST(new Request("https://dashboard.example.test/api/sync-runs", {
      method: "POST",
      headers: { origin: "https://dashboard.example.test", "content-type": "application/json" },
      body: JSON.stringify({ confirmRecent: true }),
    }));
    expect(accepted.status).toBe(202);
    expect((await accepted.json()).data.status).toBe("queued");
    expect((await adminDb`select count(*)::integer as count from public.sync_work_queue`)[0]?.count).toBe(1);
  });

});
