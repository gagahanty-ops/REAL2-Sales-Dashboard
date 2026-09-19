import { approveSnapshot, createMetricSnapshot, type MetricCellInput } from "@real2/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../tests/helpers/local-db";

import { GET as GET_OVERVIEW } from "./overview/route";
import { GET as GET_MANAGERS } from "./managers/route";
import { GET as GET_CHANNELS } from "./channels/route";
import { GET as GET_FUNNEL } from "./funnel/route";
import { GET as GET_DRILLDOWN } from "./drilldown/route";
import { GET as GET_ATTENTION } from "./attention/route";
import { GET as GET_EXPORT } from "./export.csv/route";
import { GET as GET_LEAD } from "../leads/[amoLeadId]/route";

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

vi.mock("../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({
    APP_URL: "https://dashboard.example.test",
    TOKEN_ENCRYPTION_KEY: "Xk0NO7yPo9bcFHK1ScxNu0dYfUkAsK0hZ0FLDlYA5Ss=",
  }),
}));

const ORIGIN = "https://dashboard.example.test";
const ACCOUNT_ID = 9001;
const MANAGER_ONE = 601;
const MANAGER_TWO = 602;
const RANGE = "from=2026-09-05&to=2026-09-06";

function request(path: string, query: string): Request {
  return new Request(`${ORIGIN}/api/dashboard/${path}?${query}`, {
    headers: { origin: ORIGIN },
  });
}

async function payload(response: Response): Promise<{
  ok: boolean;
  data?: Record<string, never>;
  error?: { code: string };
}> {
  return (await response.json()) as never;
}

function cells(): readonly MetricCellInput[] {
  const build = (
    reportDate: string,
    managerKey: string,
    channelKey: string,
    leadsCreated: number,
    applications: number,
    payments: number,
    revenue: string,
  ): MetricCellInput => ({
    reportDate, managerKey, channelKey, leadsCreated, applications, payments, revenue,
  });
  return [
    build("2026-09-05", "all", "all", 3, 2, 1, "1000.00"),
    build("2026-09-05", String(MANAGER_ONE), "all", 2, 1, 1, "1000.00"),
    build("2026-09-05", String(MANAGER_TWO), "all", 1, 1, 0, "0.00"),
    build("2026-09-05", "all", "site", 2, 1, 1, "1000.00"),
    build("2026-09-05", "all", "avito", 1, 1, 0, "0.00"),
    build("2026-09-05", String(MANAGER_ONE), "site", 2, 1, 1, "1000.00"),
    build("2026-09-05", String(MANAGER_TWO), "avito", 1, 1, 0, "0.00"),
  ];
}

async function seedApprovedSnapshot(): Promise<void> {
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
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
      ${connection.id}, 77, 'Synthetic', 771, 'Заявка', 772, 'Успешно реализовано',
      1, true, ${testUsers.admin.id}
    ) returning id
  `;
  if (!config) throw new Error("missing config");
  const [run] = await adminDb<{ id: string }[]>`
    insert into public.sync_runs (
      trace_id, connection_id, config_id, kind, status, started_at, finished_at
    ) values (
      ${`dashboard-api-${Date.now()}`}, ${connection.id}, ${config.id}, 'incremental',
      'success', now() - interval '3 minutes', now() - interval '1 minute'
    ) returning id
  `;
  if (!run) throw new Error("missing run");
  await adminDb`
    insert into public.amo_users (account_id, amo_user_id, name, email, is_active)
    values
      (${ACCOUNT_ID}, ${MANAGER_ONE}, 'Менеджер один', null, true),
      (${ACCOUNT_ID}, ${MANAGER_TWO}, 'Менеджер два', null, true)
  `;
  const snapshot = await createMetricSnapshot(adminDb, {
    syncRunId: run.id,
    configId: config.id,
    sourceFreshAt: new Date(),
    checksum: "a".repeat(64),
    qualitySummary: {},
    cells: cells(),
    facts: [
      {
        accountId: ACCOUNT_ID,
        amoLeadId: 101,
        displayName: "Сделка #101",
        reportDate: "2026-09-05",
        managerKey: String(MANAGER_ONE),
        managerName: "Менеджер один",
        channelKey: "site",
        currentStatusId: 772,
        priceRub: "1000.00",
        applicationAt: new Date("2026-09-06T09:00:00Z"),
        wonAt: new Date("2026-09-07T09:00:00Z"),
        currentlyWon: true,
        amoUrl: "https://555151.amocrm.ru/leads/detail/101",
        qualityCodes: [],
      },
    ],
    stageRows: [
      {
        statusId: 770,
        statusName: "Первичный контакт",
        managerKey: String(MANAGER_ONE),
        openCount: 2,
        openAmount: "1000.00",
        medianAgeSeconds: 600,
        averageAgeSeconds: 600,
      },
    ],
  });
  await approveSnapshot(adminDb, snapshot.id);
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeEach(async () => {
  await clearFixtures();
  session.user.role = "admin";
  session.user.id = testUsers.admin.id;
  session.user.amoUserId = null;
});
afterAll(async () => {
  await clearFixtures();
  await adminDb.end();
});

describe("dashboard API", () => {
  it("answers every block from one snapshot version", async () => {
    await seedApprovedSnapshot();

    const [overview, managers, channels, funnel] = await Promise.all([
      payload(await GET_OVERVIEW(request("overview", RANGE))),
      payload(await GET_MANAGERS(request("managers", RANGE))),
      payload(await GET_CHANNELS(request("channels", RANGE))),
      payload(await GET_FUNNEL(request("funnel", RANGE))),
    ]);

    const versions = [overview, managers, channels, funnel].map(
      (body) => (body.data as never as { meta: { snapshotVersion: number } }).meta.snapshotVersion,
    );
    expect(new Set(versions).size).toBe(1);
    expect(overview.ok).toBe(true);
    expect(overview.data).toMatchObject({
      totals: { leadsCreated: 3, applications: 2, payments: 1, revenueRub: "1000.00" },
    });
    expect(managers.data).toMatchObject({
      totals: { leadsCreated: 3, revenueRub: "1000.00" },
    });
    expect(channels.data).toMatchObject({
      totals: { leadsCreated: 3, revenueRub: "1000.00" },
    });
    expect(funnel.data).toMatchObject({ stages: [{ statusId: 770, openCount: 2 }] });
  });

  it("scopes a manager to their own portfolio", async () => {
    await seedApprovedSnapshot();
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    session.user.amoUserId = MANAGER_TWO;

    const overview = await payload(await GET_OVERVIEW(request("overview", RANGE)));
    const managers = await payload(await GET_MANAGERS(request("managers", RANGE)));

    expect(overview.data).toMatchObject({
      totals: { leadsCreated: 1, applications: 1, payments: 0, revenueRub: "0.00" },
    });
    expect(managers.data).toMatchObject({
      rows: [{ managerKey: String(MANAGER_TWO), managerName: "Менеджер два" }],
    });
  });

  it("refuses a manager who asks for another manager", async () => {
    await seedApprovedSnapshot();
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    session.user.amoUserId = MANAGER_TWO;

    const response = await GET_OVERVIEW(
      request("overview", `${RANGE}&manager=amo:${MANAGER_ONE}`),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a malformed filter without touching the database", async () => {
    await seedApprovedSnapshot();

    expect((await GET_OVERVIEW(request("overview", "from=2026-09-10&to=2026-09-09"))).status)
      .toBe(422);
    expect((await GET_CHANNELS(request("channels", `${RANGE}&channel=pigeon`))).status)
      .toBe(422);
    expect((await GET_MANAGERS(request("managers", `${RANGE}&manager=7`))).status).toBe(422);
  });

  it("reports initial setup instead of an empty report when no snapshot is approved", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.admin]);

    const response = await GET_OVERVIEW(request("overview", RANGE));
    const body = await payload(response);

    expect(response.status).toBe(503);
    expect(body.error?.code).toBe("E_CONFIG_INCOMPLETE");
  });

  it("pages the drill-down with a cursor bound to this snapshot and slice", async () => {
    await seedApprovedSnapshot();

    const first = await payload(
      await GET_DRILLDOWN(request("drilldown", `${RANGE}&metric=payments&limit=1`)),
    );
    const data = first.data as never as { rows: unknown[]; nextCursor: string | null };
    expect(data.rows).toHaveLength(1);
    expect(data.nextCursor).toBeNull();

    // A cursor minted for another slice must not silently move the page.
    const foreign = await GET_DRILLDOWN(
      request("drilldown", `${RANGE}&metric=payments&cursor=YWJj.ZGVm`),
    );
    expect(foreign.status).toBe(422);
  });

  it("refuses an unknown drill-down metric", async () => {
    await seedApprovedSnapshot();

    expect((await GET_DRILLDOWN(request("drilldown", `${RANGE}&metric=guesswork`))).status)
      .toBe(422);
  });

  it("lists leads that need attention with their codes", async () => {
    await seedApprovedSnapshot();
    const body = await payload(await GET_ATTENTION(request("attention", RANGE)));

    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ counters: {}, rows: [] });
  });

  it("exports the current slice as a semicolon CSV with a byte order mark", async () => {
    await seedApprovedSnapshot();

    const response = await GET_EXPORT(request("export.csv", RANGE));
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-snapshot-version")).toMatch(/^\d+$/);
    // `Response.text()` strips the byte order mark, so the bytes are checked.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain("Сделка #101");
  });

  it("exports only the manager's own leads", async () => {
    await seedApprovedSnapshot();
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    session.user.amoUserId = MANAGER_TWO;

    const text = await (await GET_EXPORT(request("export.csv", RANGE))).text();

    expect(text).not.toContain("Сделка #101");
  });

  it("opens a lead card without raw payload and hides another manager's lead", async () => {
    await seedApprovedSnapshot();
    await adminDb`
      insert into public.leads (
        account_id, amo_lead_id, pipeline_id, current_status_id,
        current_responsible_user_id, name, price_rub, created_at, created_date,
        source_updated_at, normalized_channel, normalization_config_id, amo_url
      )
      select ${ACCOUNT_ID}, 101, 77, 772, ${MANAGER_ONE}, '+7 900 000-00-11', 1000,
        '2026-09-05T09:00:00Z', '2026-09-05', '2026-09-05T09:30:00Z', 'site',
        id, 'https://555151.amocrm.ru/leads/detail/101'
      from public.pipeline_configs limit 1
    `;

    const leadContext = { params: Promise.resolve({ amoLeadId: "101" }) };
    const card = await payload(await GET_LEAD(request("", ""), leadContext));
    expect(card.data).toMatchObject({
      amoLeadId: 101,
      displayName: "Сделка #101",
      amoUrl: "https://555151.amocrm.ru/leads/detail/101",
    });
    expect(JSON.stringify(card.data)).not.toContain("900 000-00-11");

    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    session.user.amoUserId = MANAGER_TWO;
    const hidden = await GET_LEAD(request("", ""), {
      params: Promise.resolve({ amoLeadId: "101" }),
    });
    expect(hidden.status).toBe(404);
  });

  it("requires a session", async () => {
    await seedApprovedSnapshot();
    session.user.role = "manager";
    session.user.amoUserId = null;

    const response = await GET_OVERVIEW(request("overview", RANGE));

    expect(response.status).toBe(409);
  });
});
