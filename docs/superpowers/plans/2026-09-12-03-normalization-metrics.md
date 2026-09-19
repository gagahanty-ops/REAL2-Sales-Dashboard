# REAL2 Normalization and Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert raw amoCRM snapshots/events into deterministic lead history, surface data-quality problems, calculate the approved metrics, and atomically expose immutable approved snapshots.

**Architecture:** Pure Zod-validated transformations produce normalized rows from append-only raw input. Milestones and responsibility/stage timelines are derived in stable event order, quality issues remain attached to source identities, and metric snapshots are built as candidates before transactional approval. Dashboard consumers never query mutable source tables directly.

**Tech Stack:** TypeScript 5.9, Zod 4, PostgreSQL 17 numeric/date types, Vitest, PGlite, fast-check, decimal.js.

**Spec:** `SPEC.md` modules M5–M7 plus scenarios S1–S5; complete `METRICS_CATALOG.md`.

## Global Constraints

- `(amo_account_id, amo_lead_id)` identifies one lead; `(amo_account_id, amo_event_id)` identifies one event.
- Source timestamps remain UTC; business dates use `Europe/Moscow`.
- Every metric uses `report_date = created_date`, never application or won date.
- Application and won milestones are first confirmed matching transitions.
- A currently reopened won lead is removed from payment and revenue totals while history remains.
- Channel uses exact versioned rules in documented priority order; deal names/free text are never used.
- Unknown, malformed, and missing values produce quality evidence instead of disappearing.
- Decimal money reaches storage, API, CSV, and Sheet payload without floating-point arithmetic.
- Only a successful sync may build a candidate; only a candidate passing all blocking gates may become current.

---

### Task 1: Create normalized lead, history, milestone, and quality schema

**Files:**
- Create: `supabase/migrations/0010_normalized_leads.sql`
- Create: `packages/db/src/leads.ts`
- Create: `packages/db/src/quality.ts`
- Test: `packages/db/src/leads.integration.test.ts`

**Interfaces:**
- Consumes: successful `sync_run_id`, active `config_id`, and parsed raw objects/events.
- Produces: repositories for `amo_users`, `pipeline_statuses`, `leads`, `lead_stage_events`, `lead_responsible_events`, `lead_milestones`, and `data_quality_issues`.

- [x] **Step 1: Write failing database invariant tests**

```ts
it("rejects a stage event for a lead in another amo account", async () => {
  await seedNormalizedLead({ accountId: 1, amoLeadId: 55 });
  await expect(insertStageEvent({
    accountId: 2,
    amoLeadId: 55,
    amoEventId: "01pz58t6p04ymgsgfbmfyfy1mf",
  }))
    .rejects.toThrow(/foreign key/i);
});

it("allows only one open quality issue per lead and code", async () => {
  await quality.open(issueFixture);
  await quality.open(issueFixture);
  expect(await quality.countOpen(issueFixture.leadKey, issueFixture.code)).toBe(1);
});
```

- [x] **Step 2: Run tests and verify missing relation failures**

Run: `pnpm test:integration -- packages/db/src/leads.integration.test.ts`

Expected: FAIL because normalized relations do not exist.

- [x] **Step 3: Add exact keys, constraints, indexes, and RLS**

```sql
create table amo_users (
  account_id bigint not null,
  amo_user_id bigint not null,
  name text not null,
  email citext,
  is_active boolean not null,
  source_updated_at timestamptz,
  normalized_at timestamptz not null default now(),
  primary key (account_id, amo_user_id)
);

create table pipeline_statuses (
  account_id bigint not null,
  pipeline_id bigint not null,
  status_id bigint not null,
  name text not null,
  sort_order integer not null,
  is_closed boolean not null,
  is_won boolean not null,
  source_updated_at timestamptz,
  primary key (account_id, status_id)
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint not null,
  pipeline_id bigint not null,
  current_status_id bigint not null,
  current_responsible_user_id bigint,
  name text not null,
  price_rub numeric(14,2),
  created_at timestamptz not null,
  created_date date not null,
  source_updated_at timestamptz not null,
  normalized_channel text not null,
  channel_rule_id uuid references channel_rules(id),
  normalization_config_id uuid not null references pipeline_configs(id),
  amo_url text not null,
  is_deleted boolean not null default false,
  normalized_at timestamptz not null default now(),
  unique (account_id, amo_lead_id)
);

create table lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id text not null,
  amo_lead_id bigint not null,
  from_status_id bigint,
  to_status_id bigint not null,
  responsible_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create table lead_responsible_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id text not null,
  amo_lead_id bigint not null,
  from_user_id bigint,
  to_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create table lead_milestones (
  account_id bigint not null,
  amo_lead_id bigint not null,
  application_at timestamptz,
  application_responsible_user_id bigint,
  won_at timestamptz,
  won_responsible_user_id bigint,
  currently_won boolean not null default false,
  recalculated_at timestamptz not null default now(),
  primary key (account_id, amo_lead_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create type quality_severity as enum ('info', 'warning', 'blocking');
create type quality_status as enum ('open', 'resolved', 'accepted');

create table data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint,
  sync_run_id uuid references sync_runs(id),
  code text not null,
  severity quality_severity not null,
  status quality_status not null default 'open',
  safe_details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index data_quality_one_open_issue_idx
  on data_quality_issues (account_id, coalesce(amo_lead_id, 0), code)
  where status = 'open';

create index leads_created_idx on leads(created_date);
create index leads_manager_date_idx on leads(current_responsible_user_id, created_date);
create index leads_channel_date_idx on leads(normalized_channel, created_date);
create index lead_stage_timeline_idx on lead_stage_events(amo_lead_id, occurred_at, amo_event_id);
create index quality_status_idx on data_quality_issues(status, severity, code);
```

RLS lets admin/head read all normalized rows. A manager reads only `leads` whose `current_responsible_user_id` equals the active user's `amo_user_id`, plus related stage/responsible/milestone rows through an `exists` subquery on that permitted lead. Raw payload columns and raw-table relations are not exposed through manager-facing repositories or policies.

- [x] **Step 4: Apply migration and verify constraints/RLS**

Run: `supabase db reset && pnpm test:integration -- packages/db/src/leads.integration.test.ts && pnpm test:security -- tests/security/rls.security.test.ts`

Expected: PASS for composite ownership, duplicate event denial, partial-open issue index, and role scopes.

- [x] **Step 5: Commit the normalized schema**

```bash
git add supabase/migrations/0010_normalized_leads.sql packages/db tests/security/rls.security.test.ts
git commit -m "feat: add normalized lead history schema"
```

### Task 2: Normalize lead snapshots, dates, money, names, and channels

**Files:**
- Create: `packages/domain/src/time/moscow-date.ts`
- Create: `packages/domain/src/money/rubles.ts`
- Create: `packages/domain/src/leads/normalize-lead.ts`
- Create: `packages/domain/src/leads/normalize-lead.test.ts`
- Create: `packages/domain/src/leads/channel.ts`
- Create: `packages/domain/src/leads/channel.test.ts`
- Create: `packages/testkit/src/lead-builders.ts`

**Interfaces:**
- Consumes: `RawAmoLead`, `PipelineConfig`, `ChannelRule[]`, `configId`, and normalization time.
- Produces: `toMoscowDate(instant): YYYY-MM-DD`, `Rubles`, `matchChannel(input, rules): ChannelMatch`, `normalizeLead(input): NormalizedLeadResult`, and ordered quality issue candidates.

- [x] **Step 1: Write failing boundary and no-guessing tests**

```ts
it.each([
  ["2026-09-11T20:59:59Z", "2026-09-11"],
  ["2026-09-11T21:00:00Z", "2026-09-12"],
])("maps %s to Moscow business date %s", (instant, expected) => {
  expect(toMoscowDate(instant)).toBe(expected);
});

it("does not infer Instagram from a deal name", () => {
  const result = normalizeLead(buildRawLead({ name: "Instagram Мария", customSource: null, tags: [] }), context);
  expect(result.lead.normalizedChannel).toBe("unknown");
  expect(result.issues.map((issue) => issue.code)).toContain("unknown_channel");
});
```

- [x] **Step 2: Run focused tests and verify missing functions**

Run: `pnpm vitest run packages/domain/src/leads/normalize-lead.test.ts packages/domain/src/leads/channel.test.ts`

Expected: FAIL on missing normalization modules.

- [x] **Step 3: Implement deterministic normalization**

```ts
export function matchChannel(input: ChannelInput, rules: readonly ChannelRule[]): ChannelMatch {
  const orderedKinds = ["source_field_exact", "tag_exact", "integration_source_exact"] as const;
  for (const matchType of orderedKinds) {
    const values = input.valuesByMatchType[matchType];
    const matches = rules.filter((rule) => rule.isActive && rule.matchType === matchType && values.includes(rule.matchValue));
    if (new Set(matches.map((rule) => rule.normalizedChannel)).size > 1) {
      return { normalizedChannel: "unknown", ruleId: null, conflict: true };
    }
    if (matches[0]) return { normalizedChannel: matches[0].normalizedChannel, ruleId: matches[0].id, conflict: false };
  }
  return { normalizedChannel: "unknown", ruleId: null, conflict: false };
}

export function normalizeLead(input: NormalizeLeadInput): NormalizedLeadResult {
  const parsed = rawAmoLeadSchema.parse(input.raw);
  const createdAt = new Date(parsed.created_at * 1000).toISOString();
  const sourceUpdatedAt = new Date(parsed.updated_at * 1000).toISOString();
  const channel = matchChannel(extractChannelInput(parsed, input.config), input.channelRules);
  const money = parseAmoRubles(parsed.price);
  return {
    lead: {
      accountId: input.accountId,
      amoLeadId: parsed.id,
      pipelineId: parsed.pipeline_id,
      currentStatusId: parsed.status_id,
      currentResponsibleUserId: parsed.responsible_user_id ?? null,
      name: safeLeadName(parsed.name, parsed.id),
      priceRub: money.value,
      createdAt,
      createdDate: toMoscowDate(createdAt),
      sourceUpdatedAt,
      normalizedChannel: channel.normalizedChannel,
      channelRuleId: channel.ruleId,
      normalizationConfigId: input.config.id,
      amoUrl: `https://555151.amocrm.ru/leads/detail/${parsed.id}`,
      isDeleted: false,
    },
    issues: collectLeadIssues(parsed, channel, money),
  };
}
```

`parseAmoRubles` returns a decimal string with two digits or a typed invalid result; phone-like names become `Сделка #<amoLeadId>` in outward responses.

Implementation rulings (Task 2 review, 2026-09-17): the pseudocode above is illustrative. Channel attribution follows `METRICS_CATALOG.md` section 7 literally: a filled source field decides on its own (an unmapped or non-text value yields `unknown` with `unknown_channel`), and tag and integration-source kinds are consulted only when the source field is empty and only through a matching active rule. Different channels within one source kind yield `unknown` with `channel_rule_conflict`. Excluded/rejected results carry no lead row, so Task 3 must decide what happens to an already stored row whose lead left the pipeline. Outward `displayName` replaces predominantly-phone names with `Сделка #<amoLeadId>` and masks any other run of ten or more digits as `*** ***-**-NN`.

- [x] **Step 4: Run example and property tests**

Run: `pnpm vitest run packages/domain/src/leads && pnpm test:contracts`

Expected: PASS for Moscow midnight, invalid/negative/zero price policy, channel priority, stable empty names, and arbitrary Unicode input.

- [x] **Step 5: Commit deterministic lead normalization**

```bash
git add packages/domain/src/time packages/domain/src/money packages/domain/src/leads packages/testkit/src/lead-builders.ts
git commit -m "feat: normalize REAL2 lead snapshots deterministically"
```

### Task 3: Derive stage and responsibility timelines and milestones

**Files:**
- Create: `packages/domain/src/leads/build-history.ts`
- Create: `packages/domain/src/leads/build-history.test.ts`
- Create: `packages/db/src/normalize-run.ts`
- Create: `apps/worker/src/jobs/normalize-sync-run.ts`
- Create: `apps/worker/src/jobs/normalize-sync-run.integration.test.ts`

**Interfaces:**
- Consumes: one successful sync run, previous normalized lead, ordered raw events, application/won status IDs.
- Produces: `buildLeadHistory(input): LeadHistoryResult` and `normalizeSyncRun(syncRunId): NormalizeRunResult`.

- [x] **Step 1: Write failing milestone-order tests**

```ts
it("uses event ID as a stable tie-breaker and keeps first application/won times", () => {
  const events = [
    statusEvent("evt-20", "2026-09-07T09:00:00Z", applicationStatusId),
    statusEvent("evt-10", "2026-09-07T09:00:00Z", earlierStatusId),
    statusEvent("evt-30", "2026-09-10T10:00:00Z", wonStatusId),
    statusEvent("evt-40", "2026-09-11T10:00:00Z", wonStatusId),
  ];
  const result = buildLeadHistory({ events, applicationStatusId, wonStatusId });
  expect(result.milestones.applicationAt).toBe("2026-09-07T09:00:00.000Z");
  expect(result.milestones.wonAt).toBe("2026-09-10T10:00:00.000Z");
  expect(result.orderedEventIds).toEqual(["evt-10", "evt-20", "evt-30", "evt-40"]);
});
```

- [x] **Step 2: Run the focused test and verify missing history builder**

Run: `pnpm vitest run packages/domain/src/leads/build-history.test.ts`

Expected: FAIL because `buildLeadHistory` does not exist.

- [x] **Step 3: Implement pure history derivation and transactional persistence**

```ts
const ordered = [...events].sort((a, b) =>
  a.occurredAt.localeCompare(b.occurredAt) || a.amoEventId.localeCompare(b.amoEventId),
);

const applicationEvent = ordered.find((event) => event.kind === "stage" && event.toStatusId === applicationStatusId);
const wonEvent = ordered.find((event) => event.kind === "stage" && event.toStatusId === wonStatusId);
```

Persist stable `lead_stage_events` and `lead_responsible_events`; calculate closed stage durations from adjacent events and current stage age against the snapshot timestamp without adding a mutable interval table. Capture responsible IDs at creation, first application, first won, and current snapshot. `normalizeSyncRun` upserts current normalized rows and replaces derived milestone rows for affected leads in one transaction; it never edits raw data.

- [x] **Step 4: Verify repeated events, missing pairs, reassignment, and rollback**

Run: `pnpm vitest run packages/domain/src/leads/build-history.test.ts && pnpm test:integration -- apps/worker/src/jobs/normalize-sync-run.integration.test.ts`

Expected: PASS; a repeated run yields byte-equivalent derived rows; malformed history opens `missing_stage_history`; transaction failure leaves prior normalized rows intact.

- [x] **Step 5: Commit history and milestone derivation**

```bash
git add packages/domain/src/leads/build-history.ts packages/domain/src/leads/build-history.test.ts packages/db/src/normalize-run.ts apps/worker/src/jobs/normalize-sync-run.ts apps/worker/src/jobs/normalize-sync-run.integration.test.ts
git commit -m "feat: derive auditable lead timelines and milestones"
```

### Task 4: Reconcile and administer data-quality issues

**Files:**
- Create: `packages/domain/src/quality/codes.ts`
- Create: `packages/domain/src/quality/gates.ts`
- Create: `packages/domain/src/quality/gates.test.ts`
- Create: `apps/web/src/app/api/quality/issues/route.ts`
- Create: `apps/web/src/app/api/quality/issues/[id]/accept/route.ts`
- Create: `apps/web/src/app/quality/page.tsx`
- Test: `apps/web/src/app/api/quality/issues/quality.integration.test.ts`

**Interfaces:**
- Consumes: issue candidates and current open issues.
- Produces: exact quality codes, `evaluateQualityGate(summary): QualityGateResult`, paginated issue reads, and admin acceptance with a required reason.

- [x] **Step 1: Write failing blocking-gate tests**

```ts
it.each([
  ["missing_stage_history_count", 1],
  ["won_without_valid_price_count", 1],
  ["source_api_error_count", 1],
])("blocks production for %s", (key, value) => {
  const summary = qualitySummary({ [key]: value });
  expect(evaluateQualityGate(summary)).toEqual({ approved: false, blockingCodes: expect.arrayContaining([key]) });
});

it("does not block solely for an unknown channel", () => {
  expect(evaluateQualityGate(qualitySummary({ unknown_channel_count: 1 })).approved).toBe(true);
});
```

- [x] **Step 2: Run tests and verify gate implementation is missing**

Run: `pnpm vitest run packages/domain/src/quality/gates.test.ts`

Expected: FAIL on missing quality module.

- [x] **Step 3: Implement issue lifecycle and explicit gates**

The worker upserts still-present issues, resolves absent ones, and never deletes history. Acceptance requires admin and a nonblank reason of 10–500 characters; the repository stores `{ acceptanceReason, acceptedBy, acceptedAt }` in `safe_details`, changes status to `accepted`, and sets `resolved_at`. Acceptance changes publication eligibility only for codes explicitly marked acceptable in `codes.ts`; source API errors and count-drop alerts remain unacceptable.

```ts
export const qualityCodePolicy = {
  unknown_channel: { severity: "warning", blocks: false, acceptable: true },
  missing_responsible: { severity: "warning", blocks: false, acceptable: true },
  missing_stage_history: { severity: "blocking", blocks: true, acceptable: true },
  won_without_valid_price: { severity: "blocking", blocks: true, acceptable: true },
  duplicate_event: { severity: "info", blocks: false, acceptable: false },
  stale_lead: { severity: "warning", blocks: false, acceptable: true },
  source_api_error: { severity: "blocking", blocks: true, acceptable: false },
} as const;
```

- [x] **Step 4: Verify permissions, pagination, issue resolution, and gates**

Run: `pnpm vitest run packages/domain/src/quality/gates.test.ts && pnpm test:integration -- apps/web/src/app/api/quality/issues/quality.integration.test.ts`

Expected: PASS; head reads but cannot accept; manager cannot access quality endpoints; an accepted issue retains evidence and reason.

- [x] **Step 5: Commit quality issue workflows**

```bash
git add packages/domain/src/quality packages/db/src/quality.ts apps/web/src/app/api/quality apps/web/src/app/quality
git commit -m "feat: enforce explicit data-quality gates"
```

### Task 5: Implement canonical metrics against a golden dataset

**Files:**
- Create: `packages/domain/src/metrics/types.ts`
- Create: `packages/domain/src/metrics/aggregate.ts`
- Create: `packages/domain/src/metrics/aggregate.test.ts`
- Create: `packages/domain/src/metrics/periods.ts`
- Create: `packages/domain/src/metrics/periods.test.ts`
- Create: `packages/testkit/src/golden/real2-golden.ts`
- Create: `packages/testkit/src/golden/real2-golden.expected.ts`
- Test: `tests/contracts/metrics.contract.test.ts`

**Interfaces:**
- Consumes: `MetricLeadFact[]`, requested date interval, manager/channel filters.
- Produces: `aggregateMetrics(input): MetricAggregate`, conversion/average/period-comparison functions, and explicit integer/decimal-string totals.

- [x] **Step 1: Write the failing core cohort test**

```ts
it("attributes later application and payment to the lead creation day", () => {
  const facts = [metricLeadFact({
    amoLeadId: 101,
    createdDate: "2026-09-05",
    applicationAt: "2026-09-07T09:00:00Z",
    wonAt: "2026-09-10T10:00:00Z",
    currentlyWon: true,
    priceRub: "12500.50",
    channel: "phone_uis",
    managerId: 7,
  })];
  expect(aggregateMetrics({ facts, from: "2026-09-05", to: "2026-09-05" })).toMatchObject({
    leadsCreated: 1,
    applications: 1,
    payments: 1,
    revenueRub: "12500.50",
  });
});

it("returns null ratios when the denominator is zero", () => {
  expect(conversion(0, 0)).toBeNull();
  expect(conversion(1, 0)).toBeNull();
});
```

- [x] **Step 2: Run contract tests and verify missing metrics**

Run: `pnpm test:contracts -- tests/contracts/metrics.contract.test.ts`

Expected: FAIL because the metrics package is missing.

- [x] **Step 3: Implement integer counts and decimal-safe sums**

```ts
export function aggregateMetrics(input: AggregateInput): MetricAggregate {
  const selected = input.facts.filter((fact) => inDateRange(fact.createdDate, input.from, input.to) && matchesFilters(fact, input));
  const leads = uniqueBy(selected, (fact) => fact.amoLeadId);
  const applications = leads.filter((fact) => fact.applicationAt !== null);
  const payments = leads.filter((fact) => fact.currentlyWon && fact.wonAt !== null);
  const revenue = payments.reduce((sum, fact) => sum.plus(fact.priceRub ?? "0.00"), new Decimal(0));
  return {
    leadsCreated: leads.length,
    applications: applications.length,
    payments: payments.length,
    revenueRub: revenue.toFixed(2),
    leadToApplicationPct: percent(applications.length, leads.length),
    applicationToPaymentPct: percent(payments.length, applications.length),
    leadToPaymentPct: percent(payments.length, leads.length),
    averageOrderValueRub: moneyAverage(revenue, payments.length),
  };
}
```

Golden fixtures cover all ten scenarios in METRICS_CATALOG section 13, including reopened won, changed responsible, unknown channel, invalid price, duplicate event, and Moscow midnight.

- [x] **Step 4: Verify daily, manager, channel, funnel, plan, and period totals**

Run: `pnpm vitest run packages/domain/src/metrics && pnpm test:contracts -- tests/contracts/metrics.contract.test.ts`

Expected: PASS with exact expected counts, one-decimal percentages, null zero-denominator ratios, and kopeck-exact revenue.

- [x] **Step 5: Commit canonical metric engine and golden data**

```bash
git add packages/domain/src/metrics packages/testkit/src/golden tests/contracts/metrics.contract.test.ts
git commit -m "feat: calculate canonical REAL2 metrics"
```

### Task 6: Build immutable metric snapshots and versioned plans

**Files:**
- Create: `supabase/migrations/0006_metric_snapshots.sql`
- Create: `packages/db/src/snapshots.ts`
- Create: `packages/db/src/sales-plans.ts`
- Create: `apps/worker/src/jobs/build-snapshot.ts`
- Create: `apps/worker/src/jobs/build-snapshot.integration.test.ts`
- Create: `apps/web/src/app/api/plans/route.ts`
- Create: `apps/web/src/app/api/snapshots/[version]/route.ts`
- Create: `apps/web/src/app/settings/plans/page.tsx`
- Create: `apps/web/src/app/snapshots/[version]/page.tsx`

**Interfaces:**
- Consumes: a successful normalized run, metric engine, quality summary, active plan/config versions.
- Produces: `buildMetricSnapshot(syncRunId, configId)`, `validateSnapshot(snapshotId)`, `approveSnapshot(snapshotId)`, `getCurrentSnapshot()`, `MetricLeadFact`, immutable daily/manager/channel/funnel rows, and versioned plans.

- [x] **Step 1: Write failing atomic-pointer tests**

```ts
it("keeps the previous current snapshot when a candidate is blocked", async () => {
  const current = await seedApprovedSnapshot({ version: 41 });
  const candidate = await buildMetricSnapshot(syncRunWithMissingHistory, activeConfigId);
  await expect(approveSnapshot(candidate.id)).rejects.toThrow("E_DATA_QUALITY_BLOCK");
  expect((await snapshots.current()).version).toBe(current.version);
});

it("rebuilding identical input produces the same checksum", async () => {
  const first = await buildMetricSnapshot(syncRunId, activeConfigId);
  const second = await buildMetricSnapshot(syncRunId, activeConfigId);
  expect(second.checksum).toBe(first.checksum);
});
```

- [x] **Step 2: Run integration tests and verify missing snapshot relations**

Run: `pnpm test:integration -- apps/worker/src/jobs/build-snapshot.integration.test.ts`

Expected: FAIL with missing metric snapshot relation.

- [x] **Step 3: Add snapshot/fact/aggregate/plan schema and one approval transaction**

The migration creates `sales_plans`, `metric_snapshots`, `metric_cells`, `metric_lead_facts`, `stage_snapshot_rows`, and singleton `current_snapshot`. Snapshot rows reference one sync run and one configuration; channel rules are fixed through that configuration. Snapshot rows are immutable after creation.

```sql
create type plan_metric_key as enum ('leads_created', 'applications', 'payments', 'revenue');

create table sales_plans (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  manager_key text not null,
  metric_key plan_metric_key not null,
  target_value numeric(14,2) not null check (target_value > 0),
  version integer not null check (version > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (month, manager_key, metric_key, version),
  check (valid_to is null or valid_to > valid_from)
);

create type snapshot_status as enum ('candidate', 'approved', 'published', 'rejected');

create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  version bigint generated always as identity unique,
  sync_run_id uuid not null references sync_runs(id),
  config_id uuid not null references pipeline_configs(id),
  status snapshot_status not null default 'candidate',
  generated_at timestamptz not null default now(),
  source_fresh_at timestamptz not null,
  approved_at timestamptz,
  published_at timestamptz,
  checksum text not null,
  quality_summary jsonb not null,
  rejection_code text,
  unique (sync_run_id, config_id)
);

create table metric_cells (
  snapshot_id uuid not null references metric_snapshots(id),
  report_date date not null,
  manager_key text not null,
  channel_key text not null,
  leads_created integer not null check (leads_created >= 0),
  applications integer not null check (applications >= 0),
  payments integer not null check (payments >= 0),
  revenue numeric(14,2) not null,
  primary key (snapshot_id, report_date, manager_key, channel_key)
);

create table metric_lead_facts (
  snapshot_id uuid not null references metric_snapshots(id),
  account_id bigint not null,
  amo_lead_id bigint not null,
  display_name text not null,
  report_date date not null,
  manager_key text not null,
  manager_name text not null,
  channel_key text not null,
  current_status_id bigint not null,
  price_rub numeric(14,2),
  application_at timestamptz,
  won_at timestamptz,
  currently_won boolean not null,
  amo_url text not null,
  quality_codes text[] not null default '{}',
  primary key (snapshot_id, account_id, amo_lead_id)
);

create index metric_lead_facts_drilldown_idx
  on metric_lead_facts (snapshot_id, report_date, manager_key, channel_key, amo_lead_id);

create table stage_snapshot_rows (
  snapshot_id uuid not null references metric_snapshots(id),
  status_id bigint not null,
  status_name text not null,
  manager_key text not null,
  open_count integer not null check (open_count >= 0),
  open_amount numeric(14,2) not null,
  median_age_seconds bigint,
  average_age_seconds bigint,
  primary key (snapshot_id, status_id, manager_key)
);

create table current_snapshot (
  singleton boolean primary key default true check (singleton),
  snapshot_id uuid not null references metric_snapshots(id),
  updated_at timestamptz not null default now()
);
```

```ts
export async function approveSnapshot(candidateId: string): Promise<ApprovedSnapshot> {
  return db.begin(async (tx) => {
    const candidate = await snapshots.lockCandidate(tx, candidateId);
    const validation = await snapshots.validateCandidate(tx, candidate.id);
    if (!validation.approved) throw new AppError("E_DATA_QUALITY_BLOCK", 409);
    await snapshots.markApproved(tx, candidate.id);
    await snapshots.setCurrent(tx, candidate.id);
    return snapshots.getApproved(tx, candidate.id);
  });
}
```

The public `validateSnapshot(snapshotId)` opens a read-only transaction and delegates to the same `snapshots.validateCandidate` routine used by approval. It requires a successful source run, valid configuration, zero unaccepted blocking issues, `payments <= applications <= leads_created`, exact revenue cross-foot, and equality between `all/all`, manager sums, and channel sums for every date. Plan inserts require first-of-month `month`, supported metric key, strictly positive decimal target, actor, and a monotonically increasing version; they close the prior row's `valid_to` and never overwrite history. `/settings/plans` provides month, department/manager target, metric, history, and four states; `/snapshots/{version}` shows immutable checksum, source/config versions, quality summary, and cross-foot evidence.

- [x] **Step 4: Verify immutability, rollback, plan versions, and role access**

Run: `supabase db reset && pnpm test:integration -- apps/worker/src/jobs/build-snapshot.integration.test.ts && pnpm test:security`

Expected: PASS; candidate failure does not move pointer; approved rows reject update/delete; manager reads only its plan/facts.

- [x] **Step 5: Commit snapshot approval and plans**

```bash
git add supabase/migrations/0006_metric_snapshots.sql packages/db apps/worker/src/jobs/build-snapshot.ts apps/worker/src/jobs/build-snapshot.integration.test.ts apps/web/src/app/api/plans apps/web/src/app/api/snapshots apps/web/src/app/settings/plans apps/web/src/app/snapshots
git commit -m "feat: approve immutable metric snapshots"
```

### Task 7: Prove end-to-end metric consistency from raw input to snapshot

**Files:**
- Create: `tests/contracts/raw-to-snapshot.contract.test.ts`
- Create: `tests/contracts/snapshot-idempotency.contract.test.ts`
- Create: `tests/contracts/metric-catalog-coverage.test.ts`
- Create: `docs/runbooks/metric-reconciliation.md`

**Interfaces:**
- Consumes: golden raw fixtures, complete mock sync, normalization, quality, and snapshot jobs.
- Produces: one executable contract proving every catalog scenario and a manual reconciliation procedure keyed by amo lead ID.

- [x] **Step 1: Write a failing raw-to-snapshot contract**

```ts
it("matches the approved golden daily, manager, and channel rows", async () => {
  const run = await ingestGoldenRawDataset();
  await normalizeSyncRun(run.id);
  const candidate = await buildMetricSnapshot(run.id, activeConfigId);
  const approved = await approveSnapshot(candidate.id);
  expect(await snapshots.exportComparableRows(approved.id)).toEqual(real2GoldenExpectedRows);
});
```

- [x] **Step 2: Run the contract and inspect the first semantic mismatch**

Run: `pnpm test:contracts -- tests/contracts/raw-to-snapshot.contract.test.ts`

Expected: FAIL until the fixture adapters and export function are connected; failure prints stable IDs, not PII.

- [x] **Step 3: Connect the golden pipeline and catalog coverage assertion**

`metric-catalog-coverage.test.ts` asserts named coverage for leads, applications, payments, revenue, three conversions, average order value, current manager/channel attribution, funnel age, plans, period comparison, quality counters, freshness, and all ten golden scenarios.

```ts
const requiredCoverage = [
  "leads_created", "applications", "payments", "revenue",
  "lead_to_application_pct", "application_to_payment_pct", "lead_to_payment_pct",
  "average_order_value", "current_manager", "normalized_channel", "funnel_age",
  "plan_completion", "period_comparison", "quality_counters", "freshness",
  ...Array.from({ length: 10 }, (_, index) => `golden_scenario_${index + 1}`),
] as const;

it("has executable evidence for every catalog contract", () => {
  expect(new Set(metricContractEvidence.map((item) => item.contractKey)))
    .toEqual(new Set(requiredCoverage));
});
```

- [x] **Step 4: Run the complete metric gate twice**

Run: `pnpm test:contracts && pnpm test:integration && pnpm test:contracts`

Expected: all checks pass both times with identical snapshot checksums and no additional normalized/raw/event rows on the second execution.

- [x] **Step 5: Commit metric consistency evidence**

```bash
git add tests/contracts docs/runbooks/metric-reconciliation.md packages/testkit
git commit -m "test: prove raw-to-snapshot metric consistency"
```

## Plan 3 completion gate

Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contracts && pnpm test:integration && pnpm test:security && pnpm build`. Continue only when all ten golden scenarios pass exactly, repeated execution is idempotent, and no blocked candidate can become current.
