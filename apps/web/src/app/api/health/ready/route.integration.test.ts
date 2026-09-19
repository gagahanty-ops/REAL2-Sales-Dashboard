import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../../tests/helpers/local-db";

import { GET as READY } from "./route";

const adminDb = createAdminDb();
const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null as number | null,
  },
}));

vi.mock("../../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({ APP_URL: "https://dashboard.example.test" }),
}));

const ACCOUNT_ID = 9001;

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

async function seedApprovedSnapshot(
  options: Readonly<{ syncMinutesAgo: number; syncStatus?: "success" | "failed" }>,
): Promise<number> {
  const [connection] = await adminDb<{ id: string }[]>`
    insert into public.amo_connections (
      account_id, subdomain, base_url, access_token_ciphertext,
      refresh_token_ciphertext, token_expires_at, status, installed_by
    ) values (
      ${ACCOUNT_ID}, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
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
      trace_id, connection_id, config_id, kind, status, started_at, finished_at,
      error_code, error_summary
    ) values (
      ${`ready-${Date.now()}-${Math.random()}`}, ${connection.id}, ${config.id},
      'incremental', ${options.syncStatus ?? "success"},
      now() - interval '1 hour',
      now() - (${options.syncMinutesAgo} * interval '1 minute'),
      ${options.syncStatus === "failed" ? "E_AMO_UPSTREAM" : null},
      ${options.syncStatus === "failed" ? "amoCRM недоступен" : null}
    ) returning id
  `;
  if (!run) throw new Error("missing run");
  const [snapshot] = await adminDb<{ id: string; version: string }[]>`
    insert into public.metric_snapshots (
      sync_run_id, config_id, source_fresh_at, checksum, quality_summary, status,
      approved_at
    ) values (
      ${run.id}, ${config.id}, now() - interval '30 minutes', ${"a".repeat(64)},
      ${adminDb.json({})}, 'approved', now()
    ) returning id, version
  `;
  if (!snapshot) throw new Error("missing snapshot");
  await adminDb`
    insert into public.current_snapshot (singleton, snapshot_id)
    values (true, ${snapshot.id})
    on conflict (singleton) do update set snapshot_id = excluded.snapshot_id
  `;
  return Number(snapshot.version);
}

beforeEach(async () => {
  await clearFixtures();
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
});
afterAll(async () => {
  await clearFixtures();
  await adminDb.end();
});

describe("readiness probe", () => {
  it("is not ready without an approved snapshot", async () => {
    const response = await READY(new Request("https://dashboard.example.test/api/health/ready"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({ ready: false });
  });

  it("is ready with a database, a configuration and an approved snapshot", async () => {
    await seedApprovedSnapshot({ syncMinutesAgo: 2 });

    const response = await READY(new Request("https://dashboard.example.test/api/health/ready"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true });
  });

  it("stays ready on a stale snapshot instead of hiding the report", async () => {
    await seedApprovedSnapshot({ syncMinutesAgo: 45 });

    const response = await READY(new Request("https://dashboard.example.test/api/health/ready"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true });
  });

  it("never leaks configuration in the public answer", async () => {
    await seedApprovedSnapshot({ syncMinutesAgo: 90, syncStatus: "failed" });

    const response = await READY(new Request("https://dashboard.example.test/api/health/ready"));
    const text = JSON.stringify(await response.json());

    expect(text).not.toMatch(/postgres:\/\/|DATABASE_URL|token|amocrm|checksum/iu);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["ready"]);
  });
});
