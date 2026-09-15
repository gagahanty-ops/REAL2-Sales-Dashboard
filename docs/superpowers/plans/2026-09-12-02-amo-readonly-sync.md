# REAL2 amoCRM Read-Only Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect an external amoCRM OAuth integration, enforce GET-only business access in code and tests, validate the REAL2 pipeline configuration, and ingest complete raw lead/event data without changing amoCRM.

**Architecture:** One guarded transport owns every amoCRM network request and audits allow/deny outcomes. OAuth tokens are encrypted server-side and refreshed under a lock. The worker stores append-only validated pages under a sync run; cursors advance only after a complete run, and partial work cannot feed production metrics.

**Tech Stack:** TypeScript 5.9, Zod 4, Web Crypto/Node crypto, PostgreSQL 16, Vitest mock HTTP server, Node.js 22 worker.

**Spec:** `SPEC.md` modules M2–M4; `SECURITY_READ_ONLY.md` sections 3–4 and 8–11.

## Global Constraints

- Use external OAuth only; do not create a private integration or ask for the private-integration waiver.
- Exact production host is `555151.amocrm.ru`; redirects to another host are rejected.
- Business API permits only GET to the paths listed in `SECURITY_READ_ONLY.md`.
- OAuth POST is allowed only at exact normalized path `/oauth2/access_token`.
- No browser receives an amoCRM token, client secret, authorization code, or raw OAuth response.
- `SYNC_ENABLED=true` and DB `sync_enabled=true` are both required before any sync network call.
- Raw pages are append-only, schema-validated, checksummed, and retained for 90 days.
- A partial/failed sync does not advance cursors or create a production snapshot.

---

### Task 1: Enforce the amoCRM host, method, and path allowlist

**Files:**
- Create: `packages/integrations/src/amo/policy.ts`
- Create: `packages/integrations/src/amo/transport.ts`
- Create: `packages/integrations/src/amo/types.ts`
- Create: `packages/integrations/src/amo/policy.test.ts`
- Create: `packages/integrations/src/amo/transport.integration.test.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes: `AmoTokenProvider.getAccessToken()` and an injected `fetchFn`.
- Produces: `assertAmoRequestAllowed(input): NormalizedAmoRequest`, `amoFetch<T>(request): Promise<T>`, `AmoAuditSink.record(entry)`, and errors `E_AMO_METHOD_DENIED`, `E_AMO_PATH_DENIED`.

- [ ] **Step 1: Write failing policy tests for allowed and forbidden requests**

```ts
it.each([
  ["GET", "/api/v4/account"],
  ["GET", "/api/v4/leads"],
  ["GET", "/api/v4/leads/123"],
  ["GET", "/api/v4/leads/pipelines"],
  ["GET", "/api/v4/leads/pipelines/77/statuses"],
  ["GET", "/api/v4/leads/custom_fields"],
  ["GET", "/api/v4/users"],
  ["GET", "/api/v4/events"],
  ["POST", "/oauth2/access_token"],
])("allows %s %s", (method, path) => {
  expect(assertAmoRequestAllowed({ method, url: `https://555151.amocrm.ru${path}` })).toMatchObject({ method, normalizedPath: path });
});

it.each(["POST", "PATCH", "PUT", "DELETE"])("denies %s on business paths", (method) => {
  expect(() => assertAmoRequestAllowed({ method, url: "https://555151.amocrm.ru/api/v4/leads/123" }))
    .toThrowError("E_AMO_METHOD_DENIED");
});

it("denies an attacker-controlled host", () => {
  expect(() => assertAmoRequestAllowed({ method: "GET", url: "https://example.org/api/v4/leads" }))
    .toThrowError("E_AMO_PATH_DENIED");
});
```

- [ ] **Step 2: Run the policy test and verify the missing module failure**

Run: `pnpm vitest run packages/integrations/src/amo/policy.test.ts`

Expected: FAIL because `assertAmoRequestAllowed` does not exist.

- [ ] **Step 3: Implement a closed allowlist and guarded transport**

```ts
const AMO_HOST = "555151.amocrm.ru";
const businessGetPaths = [
  /^\/api\/v4\/account$/,
  /^\/api\/v4\/users$/,
  /^\/api\/v4\/leads(?:\/\d+)?$/,
  /^\/api\/v4\/leads\/custom_fields$/,
  /^\/api\/v4\/leads\/pipelines(?:\/\d+(?:\/statuses)?)?$/,
  /^\/api\/v4\/events$/,
];

export function assertAmoRequestAllowed(input: { method: string; url: string }): NormalizedAmoRequest {
  const url = new URL(input.url);
  const method = input.method.toUpperCase();
  if (url.protocol !== "https:" || url.hostname !== AMO_HOST || url.port) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }
  if (method === "POST" && url.pathname === "/oauth2/access_token") {
    return { method, url, normalizedPath: url.pathname, kind: "oauth" };
  }
  if (method !== "GET") throw new AppError("E_AMO_METHOD_DENIED", 403);
  if (!businessGetPaths.some((pattern) => pattern.test(url.pathname))) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }
  return { method, url, normalizedPath: url.pathname, kind: "business" };
}
```

`amoFetch` calls this function before resolving a token or invoking `fetchFn`, sets `redirect: "error"`, validates JSON through a caller-supplied Zod schema, and writes only the safe audit fields.

- [ ] **Step 4: Prove forbidden calls never reach the mock server**

Run: `pnpm vitest run packages/integrations/src/amo/policy.test.ts packages/integrations/src/amo/transport.integration.test.ts`

Expected: PASS; mock ledger length remains 0 for forbidden method, path, host, protocol, and redirect cases.

- [ ] **Step 5: Commit the guarded transport**

```bash
git add packages/integrations
git commit -m "feat: enforce amoCRM read-only transport"
```

### Task 2: Store encrypted OAuth state and rotating tokens

**Files:**
- Create: `supabase/migrations/0002_amo_oauth.sql`
- Create: `packages/integrations/src/amo/crypto.ts`
- Create: `packages/integrations/src/amo/oauth.ts`
- Create: `packages/db/src/amo-connections.ts`
- Create: `apps/worker/src/jobs/refresh-amo-token.ts`
- Create: `packages/integrations/src/amo/oauth.test.ts`
- Modify: `packages/domain/src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`, `AMO_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`.
- Produces: `createOAuthState(adminUserId)`, `consumeOAuthState(state)`, `exchangeAuthorizationCode(code)`, `refreshConnection(connectionId)`, `refreshDueConnections(now)`, and `AmoTokenProvider`.

- [ ] **Step 1: Write failing single-use and redaction tests**

```ts
it("consumes an OAuth state exactly once within ten minutes", async () => {
  const state = await store.createOAuthState(adminId, now);
  await expect(store.consumeOAuthState(state.value, now.plus({ minutes: 9 }))).resolves.toMatchObject({ createdBy: adminId });
  await expect(store.consumeOAuthState(state.value, now.plus({ minutes: 9 }))).rejects.toThrow("E_CONFLICT");
});

it("never serializes decrypted tokens", async () => {
  const connection = await repository.getSafeStatus(connectionId);
  expect(JSON.stringify(connection)).not.toMatch(/access_token|refresh_token|synthetic-secret/i);
});
```

- [ ] **Step 2: Run tests and verify the storage functions are missing**

Run: `pnpm vitest run packages/integrations/src/amo/oauth.test.ts`

Expected: FAIL on missing OAuth modules.

- [ ] **Step 3: Add OAuth tables and application encryption**

```sql
create type connection_status as enum ('pending', 'active', 'reauth_required', 'disabled');

create table oauth_states (
  state_hash text primary key,
  created_by uuid not null references app_users(id),
  redirect_after text not null default '/settings/integrations',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table amo_connections (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null unique,
  subdomain text not null unique check (subdomain ~ '^[a-z0-9-]+$'),
  base_url text not null,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expires_at timestamptz not null,
  status connection_status not null,
  installed_by uuid not null references app_users(id),
  installed_at timestamptz not null default now(),
  refreshed_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table oauth_states enable row level security;
alter table amo_connections enable row level security;
```

AES-256-GCM encrypts each token with a 32-byte key supplied by the secret store; each ciphertext blob includes its own random IV and authentication tag. The refresh transaction locks the connection row, exchanges the current refresh token, encrypts the new pair, updates `token_expires_at` and `refreshed_at`, and commits before returning an access token to server code. `refreshDueConnections(now)` selects active connections expiring within ten minutes and refreshes each under the same lock. A refresh failure sets `reauth_required` and prevents new sync runs. Disabled connections overwrite both ciphertext columns with cryptographically random bytes and set `disabled_at`; expired OAuth states are purged 24 hours after expiry.

- [ ] **Step 4: Verify expiry, replay, rotation, concurrency, and log redaction**

Run: `supabase db reset && pnpm vitest run packages/integrations/src/amo/oauth.test.ts && pnpm test:security`

Expected: PASS; expired/replayed states fail; proactive refresh starts at the ten-minute boundary; concurrent refresh makes one upstream POST; refresh failure sets `reauth_required`; logs contain no code or token.

- [ ] **Step 5: Commit OAuth persistence**

```bash
git add supabase/migrations/0002_amo_oauth.sql packages/integrations packages/db packages/domain/src/env.ts apps/worker/src/jobs/refresh-amo-token.ts .env.example
git commit -m "feat: secure amoCRM OAuth credentials"
```

### Task 3: Implement admin OAuth routes without exposing credentials

**Files:**
- Create: `apps/web/src/app/api/integrations/amo/status/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/start/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/callback/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/refresh/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/disconnect/route.ts`
- Create: `apps/web/src/app/settings/integrations/amo/page.tsx`
- Create: `apps/web/src/app/api/integrations/amo/oauth.integration.test.ts`

**Interfaces:**
- Consumes: OAuth functions from Task 2 and `requireRole(user, ['admin'])`.
- Produces: M2.3 endpoints and a status page showing account ID, subdomain, connection status, and token expiry only.

- [ ] **Step 1: Write a failing callback test for account binding**

```ts
it("rejects an OAuth result bound to a different account", async () => {
  amoMock.queueTokenPair(tokenPair);
  amoMock.queueAccount({ id: 999, subdomain: "another-account" });
  const response = await callbackRoute(adminRequest(validState, "auth-code"));
  expect(response.status).toBe(409);
  expect(await connectionRepository.count()).toBe(0);
});
```

- [ ] **Step 2: Run the integration test and verify routes are missing**

Run: `pnpm test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts`

Expected: FAIL on missing callback route.

- [ ] **Step 3: Implement exact routes and safe status UI**

The callback performs, in order: active admin check, state consumption, code exchange, GET `/api/v4/account`, exact host/subdomain verification, encrypted save, and safe redirect. Disconnect changes only the local connection status and performs no amoCRM business request.

```ts
export const POST = withRoute(async (request) => {
  const admin = requireRole(await requireUser(), ["admin"]);
  const { connectionId } = refreshRequestSchema.parse(await request.json());
  await refreshConnection(connectionId, admin.id);
  return success({ refreshed: true });
});
```

- [ ] **Step 4: Verify auth, replay, wrong account, refresh, and disconnect**

Run: `pnpm test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts && pnpm test:security`

Expected: PASS; non-admin receives 403; credentials never appear in body, HTML, redirect, or captured logs.

- [ ] **Step 5: Commit the OAuth administration flow**

```bash
git add apps/web/src/app/api/integrations apps/web/src/app/settings/integrations
git commit -m "feat: add external amoCRM OAuth administration"
```

### Task 4: Discover and activate versioned pipeline/channel configuration

**Files:**
- Create: `supabase/migrations/0003_amo_configuration.sql`
- Create: `packages/domain/src/amo/config.ts`
- Create: `packages/db/src/amo-config.ts`
- Create: `apps/web/src/app/api/config/discovery/route.ts`
- Create: `apps/web/src/app/api/config/current/route.ts`
- Create: `apps/web/src/app/api/config/validate/route.ts`
- Create: `apps/web/src/app/api/config/activate/route.ts`
- Create: `apps/web/src/app/api/config/channel-values/route.ts`
- Create: `apps/web/src/app/settings/pipeline/page.tsx`
- Create: `apps/web/src/app/settings/channels/page.tsx`
- Create: `apps/web/src/app/quality/config/page.tsx`
- Test: `packages/domain/src/amo/config.test.ts`
- Test: `apps/web/src/app/api/config/config.integration.test.ts`

**Interfaces:**
- Consumes: guarded GETs for pipelines, statuses, users, and lead custom fields.
- Produces: `PipelineConfigCandidate`, `validatePipelineConfig(candidate, discovery)`, `validateChannelRules(rules)`, `activatePipelineConfig(candidate, actorId)`, and an active immutable `pipeline_configs.version`.

- [ ] **Step 1: Write failing validation tests using the known candidate values**

```ts
it("accepts only status IDs belonging to the selected pipeline", () => {
  const candidate = { pipelineId: 10243278, applicationStatusId: 11, wonStatusId: 99, channelFieldId: 77 };
  const discovery = fixtureDiscovery({ pipelineId: 10243278, statusIds: [11, 12, 99] });
  expect(validatePipelineConfig(candidate, discovery).valid).toBe(true);
  expect(validatePipelineConfig({ ...candidate, applicationStatusId: 404 }, discovery).valid).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify missing configuration contract**

Run: `pnpm vitest run packages/domain/src/amo/config.test.ts`

Expected: FAIL because config schemas/functions do not exist.

- [ ] **Step 3: Add immutable config tables and deterministic rules**

```sql
create table pipeline_configs (
  id uuid primary key default gen_random_uuid(),
  amo_connection_id uuid not null references amo_connections(id),
  pipeline_id bigint not null,
  pipeline_name text not null,
  application_status_id bigint not null,
  application_status_name text not null,
  won_status_id bigint not null,
  won_status_name text not null,
  source_field_id bigint,
  timezone text not null default 'Europe/Moscow' check (timezone = 'Europe/Moscow'),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  confirmed_by uuid not null references app_users(id),
  confirmed_at timestamptz not null default now(),
  unique (amo_connection_id, version)
);

create unique index one_active_pipeline_config
on pipeline_configs (amo_connection_id)
where is_active;

create type channel_match_type as enum ('source_field_exact', 'tag_exact', 'integration_source_exact');

create table channel_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  priority smallint not null check (priority between 1 and 1000),
  match_type channel_match_type not null,
  match_value text not null,
  normalized_channel text not null check (normalized_channel in
    ('phone_uis','whatsapp','avito','instagram','site','telegram','max','unknown')),
  is_active boolean not null default true,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (config_id, match_type, match_value),
  unique (config_id, priority)
);

create table config_validations (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  checked_at timestamptz not null default now(),
  pipeline_found boolean not null,
  application_status_found boolean not null,
  won_status_found boolean not null,
  source_field_found boolean not null,
  metadata_checksum text not null,
  details jsonb not null default '{}'::jsonb
);
```

Activation locks the connection's config rows, confirms that the validation checksum still matches live discovery, clears the prior `is_active`, inserts the next version and its exact-match rules, then commits. The initial rule set must cover the known values in `METRICS_CATALOG.md`; duplicate `(match_type, match_value)` or priority values are rejected by both Zod and SQL. Successful activation queues a full recalculation from immutable raw rows; the current snapshot remains unchanged until that recalculation passes all quality gates. The pipeline and channel screens are admin-only; `/quality/config` is read-only for head and displays checksum/name/ID drift.

```ts
export const normalizedChannelSchema = z.enum([
  "phone_uis", "whatsapp", "avito", "instagram", "site", "telegram", "max", "unknown",
]);

export function validateChannelRules(rules: readonly ChannelRuleCandidate[]): void {
  const keys = rules.map((rule) => `${rule.matchType}\u0000${rule.matchValue}`);
  if (new Set(keys).size !== keys.length) throw new AppError("E_VALIDATION", 422);
  if (new Set(rules.map((rule) => rule.priority)).size !== rules.length) throw new AppError("E_VALIDATION", 422);
}
```

- [ ] **Step 4: Verify discovery uses only allowed GETs and activation is atomic**

Run: `supabase db reset && pnpm vitest run packages/domain/src/amo/config.test.ts && pnpm test:integration -- apps/web/src/app/api/config/config.integration.test.ts`

Expected: PASS; ID/name mismatch returns `E_CONFIG_INCOMPLETE`; failed activation leaves the previous config active; no screenshot-derived ID is accepted without API confirmation.

- [ ] **Step 5: Commit versioned pipeline configuration**

```bash
git add supabase/migrations/0003_amo_configuration.sql packages/domain packages/db apps/web/src/app/api/config apps/web/src/app/settings/pipeline apps/web/src/app/settings/channels apps/web/src/app/quality/config
git commit -m "feat: validate REAL2 pipeline configuration"
```

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
  cursor_external_id text,
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
  amo_event_id text not null,
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

### Task 6: Implement complete pagination, retries, overlap, and reconciliation

**Files:**
- Create: `apps/worker/src/jobs/amo-sync.ts`
- Create: `apps/worker/src/jobs/amo-sync.test.ts`
- Create: `apps/worker/src/schedule.ts`
- Create: `apps/worker/src/jobs/raw-retention.ts`
- Create: `apps/worker/src/jobs/sync-watchdog.ts`
- Create: `apps/web/src/app/api/sync-runs/route.ts`
- Create: `apps/web/src/app/api/sync-runs/[id]/route.ts`
- Create: `apps/web/src/app/sync/page.tsx`
- Create: `apps/web/src/app/sync/[id]/page.tsx`
- Create: `packages/testkit/src/amo-server.ts`
- Create: `packages/testkit/src/amo-fixtures.ts`

**Interfaces:**
- Consumes: active connection/config, DB/env controls, guarded transport, raw repositories.
- Produces: `runSync(kind, clock): Promise<SyncRunResult>`, schedules every five minutes and 02:30 Moscow reconciliation, plus M4.3 endpoints.

- [ ] **Step 1: Write failing worker tests for disabled, complete, and partial runs**

```ts
it("does not acquire a token or call the network when either switch is false", async () => {
  const result = await runSyncHarness({ envEnabled: true, dbEnabled: false });
  expect(result.kind).toBe("disabled");
  expect(result.tokenReads).toBe(0);
  expect(result.server.requests).toHaveLength(0);
});

it("does not advance cursors when page three fails after five retries", async () => {
  const before = await cursors.snapshot();
  amoServer.failPage(3, 503, 5);
  await expect(runSync("incremental", fixedClock)).resolves.toMatchObject({ status: "partial" });
  expect(await cursors.snapshot()).toEqual(before);
});
```

- [ ] **Step 2: Run worker tests and verify `runSync` is missing**

Run: `pnpm vitest run apps/worker/src/jobs/amo-sync.test.ts`

Expected: FAIL on missing worker job.

- [ ] **Step 3: Implement ordered sync with advisory lock and deterministic retry**

```ts
export async function runSync(kind: SyncKind, clock: Clock): Promise<SyncRunResult> {
  if (!env.SYNC_ENABLED || !(await controls.isEnabled("sync_enabled"))) return { kind: "disabled" };
  return locks.withAdvisoryLock("amo-sync", async () => {
    const run = await syncRuns.start(kind, clock.now());
    try {
      await ingestMetadata(run);
      await ingestEvents(run, { overlapMinutes: kind === "incremental" ? 10 : 0 });
      await ingestLeads(run, { full: kind !== "incremental" });
      await syncRuns.finishSuccessAndAdvanceCursors(run.id);
      return { status: "success", runId: run.id };
    } catch (error) {
      return syncRuns.finishNonSuccess(run.id, classifySyncFailure(error));
    }
  });
}
```

Follow `_links.next` until absent; reject repeated page checksums. Retry 401 once after locked refresh. Retry 429/5xx after 1, 3, 9, 27, and 60 seconds plus injected jitter; tests use a fake clock.

`sync-watchdog` marks a `running` run failed after 20 minutes and relies on connection close to release its advisory lock. `raw-retention` deletes raw payload/quarantine rows older than 90 days only after verifying normalized rows and stored hashes exist; it never deletes normalized history. The manual HTTP trigger returns 409 before network when another run owns the lock and requires confirmation in UI when the prior run started less than one minute ago.

- [ ] **Step 4: Verify schedules, overlaps, loops, concurrent runs, and count-drop blocking**

Run: `pnpm vitest run apps/worker/src/jobs/amo-sync.test.ts && pnpm test:integration && pnpm test:security`

Expected: PASS; one concurrent run gets `E_SYNC_LOCKED`; pagination loop fails; a full-count drop above 5% is critical; watchdog closes a 20-minute run; retention preserves hashes/history; disabled paths produce zero network calls.

- [ ] **Step 5: Commit the synchronization worker and safe status screens**

```bash
git add apps/worker apps/web/src/app/api/sync-runs apps/web/src/app/sync packages/testkit
git commit -m "feat: sync amoCRM through guarded read-only worker"
```

### Task 7: Add static safety tests and staging connection checklist

**Files:**
- Create: `tests/security/amo-imports.security.test.ts`
- Create: `tests/security/amo-methods.security.test.ts`
- Create: `packages/testkit/src/source-scan.ts`
- Create: `docs/runbooks/amo-oauth-installation.md`
- Create: `docs/runbooks/amo-sync-disable.md`

**Interfaces:**
- Consumes: repository source tree and mock request ledger.
- Produces: CI-enforced proof that no alternate amoCRM client or forbidden method exists; owner-facing installation and shutdown procedures.

- [ ] **Step 1: Write the failing static import test**

```ts
it("keeps amoCRM networking inside the guarded transport", async () => {
  const sourceFiles = await listTypeScriptFiles(["apps", "packages"]);
  const violations = await findForbiddenPatterns(sourceFiles, {
    allowFile: "packages/integrations/src/amo/transport.ts",
    patterns: [/fetch\s*\(/, /axios\./, /got\s*\(/, /undici/],
    scopeMarker: /amo/i,
  });
  expect(violations).toEqual([]);
});
```

- [ ] **Step 2: Run security tests and verify the testkit helper is missing**

Run: `pnpm test:security -- tests/security/amo-imports.security.test.ts tests/security/amo-methods.security.test.ts`

Expected: FAIL because the source-scanning helper does not exist.

- [ ] **Step 3: Implement source scanning and exact runbooks**

The installation runbook requires external integration registration, exact HTTPS redirect URI, minimum access, account-host verification, switches disabled, and written support confirmation. The shutdown runbook starts with environment and DB disablement, then token revocation/rotation and evidence capture.

```ts
export async function findForbiddenPatterns(
  files: readonly string[],
  options: { allowFile: string; patterns: readonly RegExp[]; scopeMarker: RegExp },
): Promise<SourceViolation[]> {
  const violations: SourceViolation[] = [];
  for (const file of files) {
    if (file === options.allowFile) continue;
    const source = await readFile(file, "utf8");
    if (!options.scopeMarker.test(`${file}\n${source}`)) continue;
    for (const pattern of options.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) violations.push({ file, pattern: pattern.source });
    }
  }
  return violations;
}
```

- [ ] **Step 4: Run the complete amoCRM gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contracts && pnpm test:integration && pnpm test:security && pnpm build`

Expected: all checks pass; the request ledger contains only allowlisted GETs and OAuth token POSTs; no live credential is required.

- [ ] **Step 5: Commit the amoCRM safety gate**

```bash
git add tests/security docs/runbooks/amo-oauth-installation.md docs/runbooks/amo-sync-disable.md packages/testkit
git commit -m "test: prove amoCRM integration is read-only"
```

## Plan 2 completion gate

Do not install the production OAuth integration from an implementation session. Present the passing security output, exact redirect URI, requested scopes, disabled switch state, and runbook to the account owner. Staging OAuth installation requires explicit owner action and written confirmation that the external integration does not cancel amoCRM support.
