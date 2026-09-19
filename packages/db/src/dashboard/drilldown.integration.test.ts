import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDbClient, createDbClient, type Database } from "../client";
import {
  approveSnapshot,
  createMetricSnapshot,
  type MetricCellInput,
  type MetricLeadFactInput,
} from "../snapshots";
import { getAttention } from "./attention";
import type { DashboardQueryScope } from "./cells";
import { getDrilldown, type DrilldownPosition } from "./drilldown";
import { getOverview } from "./overview";
import { withCurrentSnapshot } from "./with-snapshot";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let db: Database;

const ACCOUNT_ID = 9001;
const MANAGER_ONE = 601;
const MANAGER_TWO = 602;
const LEAD_COUNT = 90;
const NOW = new Date("2026-09-19T12:00:00.000Z");

const filters = {
  from: "2026-09-01",
  to: "2026-09-30",
  channels: [] as readonly string[],
  managerIds: [] as readonly number[],
  includeUnassigned: false,
  allManagers: true,
  compare: false,
};
const departmentScope = {
  kind: "department" as const,
  amoUserIds: [] as readonly number[],
  includeUnassigned: false,
};

/** Every third lead is a payment, every fifth carries a quality issue. */
function isPayment(index: number): boolean {
  return index % 3 === 0;
}
function hasIssue(index: number): boolean {
  return index % 5 === 0;
}
function managerOf(index: number): number {
  return index % 2 === 0 ? MANAGER_ONE : MANAGER_TWO;
}
function dayOf(index: number): string {
  return `2026-09-${String((index % 28) + 1).padStart(2, "0")}`;
}

function facts(): readonly MetricLeadFactInput[] {
  return Array.from({ length: LEAD_COUNT }, (_, index) => {
    const amoLeadId = 1_000 + index;
    return {
      accountId: ACCOUNT_ID,
      amoLeadId,
      displayName: `Сделка #${amoLeadId}`,
      reportDate: dayOf(index),
      managerKey: String(managerOf(index)),
      managerName: managerOf(index) === MANAGER_ONE ? "Менеджер один" : "Менеджер два",
      channelKey: index % 2 === 0 ? "site" : "avito",
      currentStatusId: isPayment(index) ? 772 : 770,
      priceRub: isPayment(index) ? "100.00" : null,
      // Every payment passed through the application stage first.
      applicationAt: index % 2 === 0 || isPayment(index)
        ? new Date("2026-09-15T09:00:00Z")
        : null,
      wonAt: isPayment(index) ? new Date("2026-09-16T09:00:00Z") : null,
      currentlyWon: isPayment(index),
      amoUrl: `https://555151.amocrm.ru/leads/detail/${amoLeadId}`,
      qualityCodes: hasIssue(index) ? ["unknown_channel"] : [],
    };
  });
}

/** Cells derived from the same facts, so aggregates and rows must reconcile. */
function cells(rows: readonly MetricLeadFactInput[]): readonly MetricCellInput[] {
  const keys = new Map<string, MetricCellInput>();
  const add = (
    reportDate: string,
    managerKey: string,
    channelKey: string,
    fact: MetricLeadFactInput,
  ): void => {
    const key = `${reportDate}|${managerKey}|${channelKey}`;
    const current = keys.get(key) ?? {
      reportDate,
      managerKey,
      channelKey,
      leadsCreated: 0,
      applications: 0,
      payments: 0,
      revenue: "0.00",
    };
    const payment = fact.currentlyWon && fact.wonAt !== null;
    keys.set(key, {
      ...current,
      leadsCreated: current.leadsCreated + 1,
      applications: current.applications + (fact.applicationAt === null ? 0 : 1),
      payments: current.payments + (payment ? 1 : 0),
      revenue: (Number(current.revenue) + (payment ? Number(fact.priceRub ?? "0") : 0))
        .toFixed(2),
    });
  };
  for (const fact of rows) {
    add(fact.reportDate, "all", "all", fact);
    add(fact.reportDate, fact.managerKey, "all", fact);
    add(fact.reportDate, "all", fact.channelKey, fact);
    add(fact.reportDate, fact.managerKey, fact.channelKey, fact);
  }
  return [...keys.values()];
}

async function seedApprovedSnapshot(): Promise<void> {
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
      ${`drilldown-${Date.now()}`}, ${connection.id}, ${config.id}, 'incremental',
      'success', '2026-09-19T11:00:00Z', '2026-09-19T11:55:00Z'
    ) returning id
  `;
  if (!run) throw new Error("missing run");
  await adminDb`
    insert into public.amo_users (account_id, amo_user_id, name, email, is_active)
    values
      (${ACCOUNT_ID}, ${MANAGER_ONE}, 'Менеджер один', null, true),
      (${ACCOUNT_ID}, ${MANAGER_TWO}, 'Менеджер два', null, true)
  `;
  const rows = facts();
  const snapshot = await createMetricSnapshot(db, {
    syncRunId: run.id,
    configId: config.id,
    sourceFreshAt: new Date("2026-09-19T11:50:00Z"),
    checksum: "a".repeat(64),
    qualitySummary: { unknown_channel_count: rows.filter((row) => row.qualityCodes.length > 0).length },
    cells: cells(rows),
    facts: rows,
    stageRows: [],
  });
  await approveSnapshot(db, snapshot.id);
}

async function clearFixtures(): Promise<void> {
  await adminDb.unsafe(
    "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
}

beforeAll(() => {
  db = createDbClient(localDatabaseUrl, { max: 4 });
});
beforeEach(async () => {
  await clearFixtures();
  await seedApprovedSnapshot();
});
afterAll(async () => {
  await clearFixtures();
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

async function collect(
  metric: Parameters<typeof getDrilldown>[2]["metric"],
  limit: number,
  scope: DashboardQueryScope = departmentScope,
): Promise<readonly number[]> {
  return withCurrentSnapshot(db, async (tx, snapshot) => {
    const ids: number[] = [];
    let after: DrilldownPosition | null = null;
    do {
      const page = await getDrilldown(tx, snapshot, {
        filters,
        scope,
        metric,
        after,
        limit,
      });
      ids.push(...page.rows.map((row) => row.amoLeadId));
      after = page.next;
    } while (after !== null);
    return ids;
  }).then((result) => result.data);
}

describe("drill-down pages", () => {
  it("returns every payment exactly once across cursor pages", async () => {
    const ids = await collect("payments", 37);
    const overview = await withCurrentSnapshot(db, (tx, snapshot) =>
      getOverview(tx, snapshot, { filters, scope: departmentScope, now: NOW }));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(overview.data.totals.payments);
  });

  it("reconciles leads, applications and quality rows with the aggregate", async () => {
    const overview = await withCurrentSnapshot(db, (tx, snapshot) =>
      getOverview(tx, snapshot, { filters, scope: departmentScope, now: NOW }));

    expect((await collect("leads_created", 25)).length).toBe(
      overview.data.totals.leadsCreated,
    );
    expect((await collect("applications", 25)).length).toBe(
      overview.data.totals.applications,
    );
    expect((await collect("quality_issue", 25)).length).toBe(
      facts().filter((fact) => fact.qualityCodes.length > 0).length,
    );
  });

  it("orders rows newest first and keeps the order across a page boundary", async () => {
    const single = await collect("leads_created", 100);
    const paged = await collect("leads_created", 7);

    expect(paged).toEqual(single);
    const dates = await withCurrentSnapshot(db, (tx, snapshot) =>
      getDrilldown(tx, snapshot, { filters, scope: departmentScope, metric: "leads_created", limit: 100 }));
    const reportDates = dates.data.rows.map((row) => row.createdDate);
    expect([...reportDates]).toEqual([...reportDates].sort().reverse());
  });

  it("never returns a lead outside the manager scope", async () => {
    const scope = {
      kind: "manager" as const,
      amoUserIds: [MANAGER_TWO],
      includeUnassigned: false,
    };
    const ids = await collect("leads_created", 20, scope);
    const expected = facts()
      .filter((fact) => fact.managerKey === String(MANAGER_TWO))
      .map((fact) => fact.amoLeadId);

    expect([...ids].sort()).toEqual([...expected].sort());
  });

  it("returns names without digits that could be a phone", async () => {
    const page = await withCurrentSnapshot(db, (tx, snapshot) =>
      getDrilldown(tx, snapshot, {
        filters,
        scope: departmentScope,
        metric: "leads_created",
        limit: 100,
      }));

    for (const row of page.data.rows) {
      expect(row.name).not.toMatch(/\d{10}/);
      expect(row.amoUrl).toMatch(/^https:\/\/555151\.amocrm\.ru\/leads\/detail\/\d+$/);
    }
  });

  it("refuses an impossible page size", async () => {
    await expect(
      withCurrentSnapshot(db, (tx, snapshot) =>
        getDrilldown(tx, snapshot, {
          filters,
          scope: departmentScope,
          metric: "leads_created",
          limit: 101,
        })),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("groups attention rows by their open quality codes", async () => {
    const attention = await withCurrentSnapshot(db, (tx, snapshot) =>
      getAttention(tx, snapshot, { filters, scope: departmentScope }));

    const expected = facts().filter((fact) => fact.qualityCodes.length > 0).length;
    expect(attention.data.counters).toEqual({ unknown_channel: expected });
    expect(attention.data.rows).toHaveLength(expected);
  });
});
