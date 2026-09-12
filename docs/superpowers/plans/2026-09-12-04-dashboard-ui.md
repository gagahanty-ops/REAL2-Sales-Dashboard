# REAL2 Dashboard API and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a private, responsive Russian-language sales dashboard whose APIs, drill-downs, exports, and screens read one approved snapshot with strict role scoping.

**Architecture:** Route handlers parse a shared filter contract, derive authorization scope from the server session, lock one current snapshot version per response, and query immutable facts/aggregates. The UI keeps filters in the URL, uses the same typed responses for cards/tables/charts, implements four states, and preserves the last valid result when refresh fails.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS 4, shadcn/ui, Recharts 3, Zod 4, TanStack Query 5, Vitest, Testing Library, Playwright.

**Spec:** `SPEC.md` modules M7–M8 and M1 role rules; `METRICS_CATALOG.md`; `SECURITY_READ_ONLY.md` sections 6–7.

## Global Constraints

- Every response and export uses exactly one immutable `snapshot_version`.
- Date range filters operate on `created_date` in `Europe/Moscow`.
- Manager scope is derived from the authenticated `app_users.amo_user_id`; request data cannot broaden it.
- Admin/head may see the department; manager sees self only.
- Lists mask phones; full client PII is not returned by dashboard APIs.
- Count totals are integers, money is decimal string/kopeck-safe, and zero-denominator ratios are null.
- Every screen has loading, error, empty, success, and stale-refresh behavior.
- Aggregate totals and drill-down rows must reconcile under identical filters.
- UI strings are Russian and interactive controls satisfy keyboard use, visible focus, and WCAG AA contrast.

---

### Task 1: Define dashboard filters, role scope, and response contracts

**Files:**
- Create: `packages/domain/src/dashboard/filters.ts`
- Create: `packages/domain/src/dashboard/contracts.ts`
- Create: `packages/domain/src/dashboard/scope.ts`
- Create: `packages/domain/src/dashboard/filters.test.ts`
- Create: `packages/domain/src/dashboard/scope.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: untrusted URL parameters and authenticated `SessionUser`.
- Produces: `DashboardFilters`, `DashboardScope`, `parseDashboardFilters(searchParams)`, `deriveDashboardScope(user, filters)`, and Zod response schemas for overview/managers/channels/funnel/attention/drill-down.

- [ ] **Step 1: Write failing filter and privilege-escalation tests**

```ts
it("parses an inclusive Moscow creation-date interval", () => {
  expect(parseDashboardFilters(new URLSearchParams("from=2026-09-01&to=2026-09-30&channel=phone_uis"))).toEqual({
    from: "2026-09-01",
    to: "2026-09-30",
    channels: ["phone_uis"],
    managerIds: [],
    compare: true,
  });
});

it("forces manager scope to the session amo user", () => {
  const requested = dashboardFilters({ managerIds: [999] });
  expect(deriveDashboardScope(managerSession({ amoUserId: 42 }), requested)).toEqual({ kind: "manager", amoUserIds: [42] });
});
```

- [ ] **Step 2: Run focused tests and verify modules are missing**

Run: `pnpm vitest run packages/domain/src/dashboard/filters.test.ts packages/domain/src/dashboard/scope.test.ts`

Expected: FAIL because dashboard contracts do not exist.

- [ ] **Step 3: Implement strict filters and typed envelopes**

```ts
export const dashboardFiltersSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  channels: z.array(normalizedChannelSchema).max(8).default([]),
  managerIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
  compare: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.from > value.to) ctx.addIssue({ code: "custom", message: "Дата начала позже даты окончания" });
  if (daysInclusive(value.from, value.to) > 366) ctx.addIssue({ code: "custom", message: "Максимальный период — 366 дней" });
});

export function deriveDashboardScope(user: SessionUser, filters: DashboardFilters): DashboardScope {
  if (user.role === "manager") {
    if (!user.amoUserId) throw new AppError("E_CONFIG_INCOMPLETE", 409);
    return { kind: "manager", amoUserIds: [user.amoUserId] };
  }
  return { kind: "department", amoUserIds: filters.managerIds };
}
```

Contracts use camelCase outward fields, decimal strings for rubles, ISO dates, nullable ratios, `trace_id`, snapshot version, generated time, source freshness, and stale flag.

- [ ] **Step 4: Run contracts and property tests**

Run: `pnpm vitest run packages/domain/src/dashboard && pnpm test:contracts`

Expected: PASS for invalid dates, repeated query keys, unknown channels, 366-day boundary, manager without mapping, and ignored privilege-escalation input.

- [ ] **Step 5: Commit shared dashboard contracts**

```bash
git add packages/domain/src/dashboard packages/domain/src/index.ts
git commit -m "feat: define role-scoped dashboard contracts"
```

### Task 2: Query one approved snapshot for overview, managers, channels, and funnel

**Files:**
- Create: `packages/db/src/dashboard/with-snapshot.ts`
- Create: `packages/db/src/dashboard/overview.ts`
- Create: `packages/db/src/dashboard/managers.ts`
- Create: `packages/db/src/dashboard/channels.ts`
- Create: `packages/db/src/dashboard/funnel.ts`
- Create: `packages/db/src/dashboard/dashboard.integration.test.ts`
- Create: `apps/web/src/lib/dashboard/handler.ts`
- Create: `apps/web/src/app/api/dashboard/overview/route.ts`
- Create: `apps/web/src/app/api/dashboard/managers/route.ts`
- Create: `apps/web/src/app/api/dashboard/channels/route.ts`
- Create: `apps/web/src/app/api/dashboard/funnel/route.ts`

**Interfaces:**
- Consumes: `DashboardFilters`, `DashboardScope`, current snapshot pointer.
- Produces: `withCurrentSnapshot(query)`, `getOverview`, `getManagerMetrics`, `getChannelMetrics`, `getFunnelMetrics`, and four M7 API endpoints.

- [ ] **Step 1: Write a failing snapshot-consistency test**

```ts
it("keeps one snapshot when current pointer changes during a request", async () => {
  await seedSnapshots({ currentVersion: 41, nextVersion: 42 });
  const response = await getOverviewWithHook(filters, leadershipScope, async () => setCurrentSnapshot(42));
  expect(response.meta.snapshotVersion).toBe(41);
  expect(response.data.kpis.revenueRub).toBe(expectedVersion41.revenueRub);
  expect(response.data.daily.every((row) => row.snapshotVersion === 41)).toBe(true);
});
```

- [ ] **Step 2: Run the integration test and verify repository modules are missing**

Run: `pnpm test:integration -- packages/db/src/dashboard/dashboard.integration.test.ts`

Expected: FAIL because `withCurrentSnapshot` does not exist.

- [ ] **Step 3: Implement transaction-scoped snapshot reads**

```ts
export async function withCurrentSnapshot<T>(
  fn: (tx: Sql, snapshot: SnapshotMeta) => Promise<T>,
): Promise<{ data: T; snapshot: SnapshotMeta }> {
  return db.begin("read only", async (tx) => {
    const [snapshot] = await tx<SnapshotMeta[]>`
      select s.* from current_snapshot p
      join metric_snapshots s on s.id = p.current_snapshot_id
      where p.singleton = true and s.status = 'approved'
    `;
    if (!snapshot) throw new AppError("E_NOT_FOUND", 404, "Нет утверждённого снимка");
    return { data: await fn(tx, snapshot), snapshot };
  });
}
```

All queries use half-open SQL boundaries `created_date >= from AND created_date < to + 1 day`, apply the server-derived manager scope, and compute totals from immutable fact/aggregate rows. `meta.stale` is true when the last successful sync ended more than ten minutes before request time.

- [ ] **Step 4: Verify totals, filters, null ratios, and role scopes**

Run: `pnpm test:integration -- packages/db/src/dashboard/dashboard.integration.test.ts && pnpm test:security`

Expected: PASS; each table total equals overview under identical filters; manager cannot observe another manager by ID, totals, timing branch, or error difference.

- [ ] **Step 5: Commit aggregate dashboard APIs**

```bash
git add packages/db/src/dashboard apps/web/src/lib/dashboard apps/web/src/app/api/dashboard/overview apps/web/src/app/api/dashboard/managers apps/web/src/app/api/dashboard/channels apps/web/src/app/api/dashboard/funnel
git commit -m "feat: serve snapshot-consistent dashboard aggregates"
```

### Task 3: Implement attention, drill-down, lead detail, and CSV export

**Files:**
- Create: `packages/db/src/dashboard/attention.ts`
- Create: `packages/db/src/dashboard/drilldown.ts`
- Create: `packages/domain/src/dashboard/cursor.ts`
- Create: `apps/web/src/app/api/dashboard/attention/route.ts`
- Create: `apps/web/src/app/api/dashboard/drilldown/route.ts`
- Create: `apps/web/src/app/api/dashboard/export.csv/route.ts`
- Create: `apps/web/src/app/api/leads/[amoLeadId]/route.ts`
- Test: `packages/db/src/dashboard/drilldown.integration.test.ts`
- Test: `apps/web/src/app/api/dashboard/export.contract.test.ts`

**Interfaces:**
- Consumes: one snapshot, filters/scope, drill-down metric key, opaque cursor.
- Produces: stable cursor pages of up to 100 masked lead rows, quality/attention groups, auditable lead detail, and UTF-8 semicolon CSV.

- [ ] **Step 1: Write failing cursor and reconciliation tests**

```ts
it("returns every payment exactly once across cursor pages", async () => {
  const ids: number[] = [];
  let cursor: string | null = null;
  do {
    const page = await getDrilldown({ ...paymentFilters, cursor, limit: 37 }, leadershipScope);
    ids.push(...page.items.map((item) => item.amoLeadId));
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe((await getOverview(paymentFilters, leadershipScope)).payments);
});
```

- [ ] **Step 2: Run tests and verify drill-down repository is missing**

Run: `pnpm test:integration -- packages/db/src/dashboard/drilldown.integration.test.ts`

Expected: FAIL on missing `getDrilldown`.

- [ ] **Step 3: Implement signed opaque cursors and safe rows**

```ts
type DrilldownCursor = {
  snapshotVersion: number;
  createdDate: string;
  amoLeadId: number;
  filterHash: string;
};

export function maskPhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 2 ? `+7 *** ***-**-${digits.slice(-2)}` : null;
}
```

Cursor decode verifies HMAC, snapshot version, and filter hash. SQL orders by `(created_date DESC, amo_lead_id DESC)`. Lead detail includes safe name, status/responsible/channel, milestone and stage histories, issue codes, and exact amoCRM URL; it excludes raw payload/custom-field text/full phone.

- [ ] **Step 4: Verify page boundaries, export formulas, escaping, and access**

Run: `pnpm test:integration -- packages/db/src/dashboard/drilldown.integration.test.ts && pnpm test:contracts -- apps/web/src/app/api/dashboard/export.contract.test.ts && pnpm test:security`

Expected: PASS; CSV prefixes cells beginning `=`, `+`, `-`, or `@` with an apostrophe; manager export contains only self; drill-down count matches aggregate.

- [ ] **Step 5: Commit auditable detail and export**

```bash
git add packages/db/src/dashboard packages/domain/src/dashboard/cursor.ts apps/web/src/app/api/dashboard/attention apps/web/src/app/api/dashboard/drilldown apps/web/src/app/api/dashboard/export.csv apps/web/src/app/api/leads
git commit -m "feat: add auditable dashboard drill-down and export"
```

### Task 4: Build the dashboard shell, URL filters, and data-state primitives

**Files:**
- Create: `apps/web/src/app/(dashboard)/layout.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/page.tsx`
- Create: `apps/web/src/components/dashboard/app-shell.tsx`
- Create: `apps/web/src/components/dashboard/filter-bar.tsx`
- Create: `apps/web/src/components/dashboard/freshness-banner.tsx`
- Create: `apps/web/src/components/data-state.tsx`
- Create: `apps/web/src/lib/dashboard/query-client.tsx`
- Create: `apps/web/src/lib/dashboard/use-dashboard-query.ts`
- Create: `apps/web/src/components/dashboard/filter-bar.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: dashboard endpoints and `DashboardFilters` URL representation.
- Produces: `AppShell`, `FilterBar`, `DataState`, `FreshnessBanner`, `useDashboardQuery`, and canonical URL search parameters.

- [ ] **Step 1: Write failing URL/state behavior tests**

```tsx
it("writes filters to the URL and keeps the prior result during refresh failure", async () => {
  const user = userEvent.setup();
  render(<DashboardHarness initialUrl="/dashboard?from=2026-09-01&to=2026-09-30" />);
  await user.click(screen.getByRole("checkbox", { name: "UIS / звонки" }));
  expect(currentUrl()).toContain("channel=phone_uis");
  server.failNext("/api/dashboard/overview", 503);
  await user.click(screen.getByRole("button", { name: "Обновить" }));
  expect(screen.getByText("Показаны последние доступные данные")).toBeVisible();
  expect(screen.getByText("7 038 599 ₽")).toBeVisible();
});
```

- [ ] **Step 2: Run the component test and verify missing components**

Run: `pnpm vitest run apps/web/src/components/dashboard/filter-bar.test.tsx`

Expected: FAIL because dashboard UI primitives do not exist.

- [ ] **Step 3: Implement restrained visual tokens and four states**

```css
:root {
  --surface: 0 0% 100%;
  --surface-muted: 215 25% 96%;
  --ink: 222 47% 11%;
  --ink-muted: 215 16% 42%;
  --brand: 211 100% 42%;
  --positive: 151 62% 33%;
  --warning: 35 92% 44%;
  --danger: 0 72% 45%;
  --border: 214 25% 86%;
  --radius: 0.75rem;
}
```

Use a calm operational layout: light neutral canvas, dark navy navigation, blue interactive accents, green only for positive outcomes, amber/red only for attention. `DataState` renders a shape-matched skeleton, retryable error with trace ID, explanatory empty message, or content. TanStack Query uses `placeholderData: keepPreviousData`; stale errors show a banner without zeroing cards.

- [ ] **Step 4: Verify keyboard, focus, URL restoration, and stale behavior**

Run: `pnpm vitest run apps/web/src/components/dashboard apps/web/src/lib/dashboard && pnpm typecheck`

Expected: PASS; filters survive reload/back/forward; every control has an accessible name and visible focus; previous content remains visible on refresh error.

- [ ] **Step 5: Commit dashboard shell and state handling**

```bash
git add apps/web/src/app apps/web/src/components/dashboard apps/web/src/components/data-state.tsx apps/web/src/lib/dashboard
git commit -m "feat: add resilient dashboard shell and filters"
```

### Task 5: Implement overview, managers, channels, funnel, and attention views

**Files:**
- Create: `apps/web/src/components/dashboard/kpi-grid.tsx`
- Create: `apps/web/src/components/dashboard/daily-trend.tsx`
- Create: `apps/web/src/components/dashboard/plan-progress.tsx`
- Create: `apps/web/src/components/dashboard/manager-table.tsx`
- Create: `apps/web/src/components/dashboard/channel-table.tsx`
- Create: `apps/web/src/components/dashboard/funnel-view.tsx`
- Create: `apps/web/src/components/dashboard/attention-panel.tsx`
- Create: `apps/web/src/components/dashboard/drilldown-drawer.tsx`
- Create: `apps/web/src/app/(dashboard)/managers/page.tsx`
- Create: `apps/web/src/app/(dashboard)/managers/[amoUserId]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/channels/page.tsx`
- Create: `apps/web/src/app/(dashboard)/funnel/page.tsx`
- Create: `apps/web/src/app/(dashboard)/attention/page.tsx`
- Test: `apps/web/src/components/dashboard/metric-views.test.tsx`

**Interfaces:**
- Consumes: typed M7 responses and URL filters.
- Produces: KPI cards, daily trend, plan/fact, manager/channel tables, funnel, attention list, and drill-down drawer using identical filters.

- [ ] **Step 1: Write failing semantic rendering tests**

```tsx
it("renders null conversion as an em dash and opens reconciled drill-down", async () => {
  const user = userEvent.setup();
  render(<KpiGrid data={overviewFixture({ leadsCreated: 0, leadToApplicationPct: null })} />);
  expect(screen.getByLabelText("Конверсия из лида в заявку")).toHaveTextContent("—");
  await user.click(screen.getByRole("button", { name: "Открыть лиды: 0" }));
  expect(screen.getByRole("dialog", { name: "Лиды" })).toBeVisible();
});
```

- [ ] **Step 2: Run view tests and verify components are missing**

Run: `pnpm vitest run apps/web/src/components/dashboard/metric-views.test.tsx`

Expected: FAIL on missing `KpiGrid`.

- [ ] **Step 3: Implement views with shared formatters and drill-down links**

Each numeric aggregate is a button/link when drill-down is permitted. Manager rows link to `/managers/{amoUserId}` with the same URL date/channel filters and plan/fact detail. Tables retain text labels outside color. Recharts receives numbers only after safe decimal-to-display conversion and never becomes a calculation source. Mobile uses scrollable tables with pinned first column; desktop keeps filters visible below the header.

```ts
export const formatCount = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
export const formatRubles = (value: string) => new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(Number(value));
export const formatPercent = (value: number | null) => value === null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
```

- [ ] **Step 4: Verify totals, labels, responsive layouts, and detail links**

Run: `pnpm vitest run apps/web/src/components/dashboard && pnpm test:contracts && pnpm typecheck`

Expected: PASS; table totals equal overview fixtures; null is never shown as zero; all chart information has a textual/table equivalent.

- [ ] **Step 5: Commit complete dashboard views**

```bash
git add apps/web/src/components/dashboard apps/web/src/app/\(dashboard\)
git commit -m "feat: render REAL2 sales performance views"
```

### Task 6: Add role, state, accessibility, and performance E2E gates

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.setup.ts`
- Create: `tests/e2e/dashboard-roles.spec.ts`
- Create: `tests/e2e/dashboard-states.spec.ts`
- Create: `tests/e2e/dashboard-filters.spec.ts`
- Create: `tests/e2e/dashboard-accessibility.spec.ts`
- Create: `tests/e2e/dashboard-performance.spec.ts`
- Create: `docs/runbooks/dashboard-access.md`

**Interfaces:**
- Consumes: seeded approved snapshot and admin/head/manager browser states.
- Produces: executable proof of role boundaries, four states, URL behavior, basic accessibility, and p95-compatible response budgets.

- [ ] **Step 1: Write a failing manager-isolation E2E scenario**

```ts
test("manager cannot reveal another manager through UI or API", async ({ page, request }) => {
  await loginAs(page, "manager-one");
  await page.goto("/dashboard?managerId=999");
  await expect(page.getByText("Менеджер Один")).toBeVisible();
  await expect(page.getByText("Менеджер Два")).toHaveCount(0);
  const response = await request.get("/api/dashboard/drilldown?managerId=999&from=2026-09-01&to=2026-09-30");
  expect(response.status()).toBe(200);
  expect((await response.json()).data.items.every((row) => row.managerId === 42)).toBe(true);
});
```

- [ ] **Step 2: Run E2E and verify fixtures/routes are incomplete**

Run: `pnpm test:e2e -- tests/e2e/dashboard-roles.spec.ts`

Expected: FAIL until seeded auth states and app routes are connected.

- [ ] **Step 3: Implement deterministic E2E seeding and state interception**

Create synthetic identities and snapshot only. Network interception returns delayed success, retryable error, empty response, and stale metadata without calling amoCRM or Google. Accessibility checks include landmark names, heading order, keyboard-only filters/drawer, focus return, and automated serious/critical violation scan.

```ts
export async function seedDashboardE2E(): Promise<E2ESeed> {
  const users = await seedSyntheticUsers([
    { key: "admin", role: "admin", amoUserId: null },
    { key: "head", role: "head", amoUserId: null },
    { key: "manager-one", role: "manager", amoUserId: 42 },
    { key: "manager-two", role: "manager", amoUserId: 84 },
  ]);
  const snapshot = await seedApprovedGoldenSnapshot({ version: 42, users });
  return { users, snapshotVersion: snapshot.version };
}

export async function failNextOverview(page: Page, traceId = "01J00000000000000000000000") {
  await page.route("**/api/dashboard/overview?**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "E_AMO_UPSTREAM", message: "Источник временно недоступен", trace_id: traceId } }),
    });
  }, { times: 1 });
}
```

- [ ] **Step 4: Run the complete dashboard gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contracts && pnpm test:integration && pnpm test:security && pnpm test:e2e && pnpm build`

Expected: all checks pass; prepared overview API p95 is below 2 seconds, ready-filter query below 700 ms, and drill-down page below 1.5 seconds in the seeded CI profile.

- [ ] **Step 5: Commit UI release evidence**

```bash
git add playwright.config.ts tests/e2e docs/runbooks/dashboard-access.md
git commit -m "test: verify dashboard roles states and accessibility"
```

## Plan 4 completion gate

Give staff access only after admin/head/manager E2E tests pass, the current snapshot banner shows accurate freshness, every aggregate reconciles with drill-down, and an independent reviewer verifies masked PII and RLS behavior. This gate still performs no Google Sheet publication.
