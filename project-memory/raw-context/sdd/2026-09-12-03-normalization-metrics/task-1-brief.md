### Task 1: Create normalized lead, history, milestone, and quality schema

**Files:**
- Create: `supabase/migrations/0010_normalized_leads.sql`
- Create: `packages/db/src/leads.ts`
- Create: `packages/db/src/quality.ts`
- Test: `packages/db/src/leads.integration.test.ts`

**Interfaces:**
- Consumes: successful `sync_run_id`, active `config_id`, and parsed raw objects/events.
- Produces: repositories for `amo_users`, `pipeline_statuses`, `leads`, `lead_stage_events`, `lead_responsible_events`, `lead_milestones`, and `data_quality_issues`.

- [ ] **Step 1: Write failing database invariant tests**

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

- [ ] **Step 2: Run tests and verify missing relation failures**

Run: `pnpm test:integration -- packages/db/src/leads.integration.test.ts`

Expected: FAIL because normalized relations do not exist.

- [ ] **Step 3: Add exact keys, constraints, indexes, and RLS**

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

- [ ] **Step 4: Apply migration and verify constraints/RLS**

Run: `supabase db reset && pnpm test:integration -- packages/db/src/leads.integration.test.ts && pnpm test:security -- tests/security/rls.security.test.ts`

Expected: PASS for composite ownership, duplicate event denial, partial-open issue index, and role scopes.

- [ ] **Step 5: Commit the normalized schema**

```bash
git add supabase/migrations/0010_normalized_leads.sql packages/db tests/security/rls.security.test.ts
git commit -m "feat: add normalized lead history schema"
```

