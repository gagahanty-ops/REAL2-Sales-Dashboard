### Task 5: Persist append-only sync runs, pages, raw objects, events, and audit

**Files:**
- Create: `supabase/migrations/0004_raw_sync.sql`
- Create: `packages/db/src/sync-runs.ts`
- Create: `packages/db/src/raw-amo.ts`
- Create: `packages/integrations/src/amo/schemas.ts`
- Test: `packages/db/src/raw-amo.integration.test.ts`

**Interfaces:**
- Consumes: validated amoCRM response pages and `trace_id`.
- Produces: `startSyncRun(type)`, `appendRawPage(runId, page)`, `finishSyncRun(runId, outcome)`, `quarantineRawPage(runId, reason, payloadHash)`, and durable cursors.

- [ ] **Step 1: Write a failing idempotency and immutability test**

```ts
it("stores a repeated event once and forbids raw updates", async () => {
  await repository.appendEvents(runId, [eventFixture, eventFixture]);
  expect(await repository.countEvents(eventFixture.id)).toBe(1);
  await expect(repository.updateRawEvent(eventFixture.id, { type: "changed" })).rejects.toThrow();
});
```

- [ ] **Step 2: Run the integration test and verify missing raw relations**

Run: `pnpm test:integration -- packages/db/src/raw-amo.integration.test.ts`

Expected: FAIL with missing `sync_runs` relation.

- [ ] **Step 3: Add the M4 append-only schema and repository transactions**

```sql
create type sync_kind as enum ('initial_backfill', 'incremental', 'nightly_reconciliation', 'manual');
create type sync_status as enum ('running', 'success', 'partial', 'failed');

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  connection_id uuid not null references amo_connections(id),
  config_id uuid not null references pipeline_configs(id),
  kind sync_kind not null,
  status sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_read integer not null default 0 check (pages_read >= 0),
  leads_read integer not null default 0 check (leads_read >= 0),
  events_read integer not null default 0 check (events_read >= 0),
  users_read integer not null default 0 check (users_read >= 0),
  retries integer not null default 0 check (retries >= 0),
  source_max_updated_at timestamptz,
  error_code text,
  error_summary text,
  checksum text,
  created_by uuid references app_users(id),
  check ((status = 'running' and finished_at is null) or
         (status <> 'running' and finished_at is not null))
);

create table sync_cursors (
  connection_id uuid not null references amo_connections(id),
  stream text not null check (stream in ('leads','events','users','metadata')),
  cursor_time timestamptz,
  cursor_external_id bigint,
  last_successful_run_id uuid references sync_runs(id),
  updated_at timestamptz not null default now(),
  primary key (connection_id, stream)
);

create type raw_entity_type as enum ('account', 'pipeline', 'status', 'user', 'lead');

create table raw_amo_objects (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  account_id bigint not null,
  entity_type raw_entity_type not null,
  external_id bigint not null,
  source_updated_at timestamptz,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (sync_run_id, entity_type, external_id)
);

create table raw_amo_events (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  account_id bigint not null,
  amo_event_id bigint not null,
  amo_lead_id bigint,
  event_type text not null,
  event_at timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (account_id, amo_event_id)
);

create table raw_amo_quarantine (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  stream text not null,
  page_number integer not null check (page_number > 0),
  reason_code text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (sync_run_id, stream, page_number, payload_sha256)
);

create table amo_api_audit (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references sync_runs(id),
  trace_id text not null,
  method text not null,
  normalized_path text not null,
  response_status integer,
  duration_ms integer not null check (duration_ms >= 0),
  attempt smallint not null check (attempt > 0),
  result text not null check (result in ('allowed','denied','success','error')),
  created_at timestamptz not null default now()
);

create index raw_objects_lookup_idx on raw_amo_objects(entity_type, external_id, received_at desc);
create index raw_events_lead_idx on raw_amo_events(amo_lead_id, event_at, amo_event_id);
create index sync_runs_status_idx on sync_runs(status, started_at desc);
create index amo_api_audit_run_idx on amo_api_audit(sync_run_id, created_at);
```

`raw_amo_quarantine` is the concrete storage required by M4.6 for a page that returns 200 but fails its Zod contract. All raw tables deny UPDATE/DELETE to application roles; a 90-day service retention job deletes payload rows only after normalized history and hashes are retained.

```ts
export type SyncOutcome =
  | { status: "success"; nextCursors: Record<string, string>; counts: SyncCounts }
  | { status: "partial" | "failed"; safeError: string; counts: SyncCounts };

export async function finishSyncRun(runId: string, outcome: SyncOutcome): Promise<void> {
  await db.begin(async (tx) => {
    await syncRuns.finish(tx, runId, outcome);
    if (outcome.status === "success") await cursors.replace(tx, outcome.nextCursors);
  });
}
```

- [ ] **Step 4: Verify duplicates, partial cursor rollback, audit shape, and RLS**

Run: `supabase db reset && pnpm test:integration -- packages/db/src/raw-amo.integration.test.ts && pnpm test:security`

Expected: PASS; repeated payload/event does not duplicate; partial run retains diagnostics but the previous cursor; audit has no query values or body.

- [ ] **Step 5: Commit the raw synchronization journal**

```bash
git add supabase/migrations/0004_raw_sync.sql packages/db packages/integrations/src/amo/schemas.ts
git commit -m "feat: persist append-only amoCRM sync journal"
```
