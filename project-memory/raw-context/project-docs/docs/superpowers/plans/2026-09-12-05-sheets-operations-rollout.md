# REAL2 Sheet Publication, Operations, and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely publish approved metrics to one validated Google Sheet copy, add monitoring/backups/runbooks, and complete a reversible shadow rollout without ever editing the original Sheet or amoCRM.

**Architecture:** The user manually creates a Google Sheet copy and shares only that copy with a service account. A fail-closed target policy, explicit range mapping, layout fingerprint, one-batch write, and read-back checksum protect publication. Operations expose safe health/alerts and retain the last good dashboard/sheet state; production switches remain manual release controls.

**Tech Stack:** TypeScript 5.9, Google Sheets API v4, PostgreSQL 16, Node.js 22 worker, SMTP alerts, Docker Compose, Caddy 2, Supabase Pro backups, Vitest, Playwright.

**Spec:** `SPEC.md` modules M9–M10 and scenarios S5–S8; `SECURITY_READ_ONLY.md` sections 5 and 9–12.

## Global Constraints

- The protected spreadsheet ID is the immutable code constant `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`.
- The protected ID cannot be removed or overridden by environment, database, request, or UI input.
- The service account is shared only onto the manually created copy; it is not shared onto the original.
- Environment `SHEET_PUBLISH_ENABLED` and DB `sheet_publish_enabled` must both be true before Google client construction.
- Publication reads one approved snapshot and modifies only explicit mapped ranges.
- Layout drift, overlapping mappings, incomplete snapshot, Google error, or checksum mismatch blocks publication and preserves the last successful report.
- Sync/publication switches start false and are never enabled by migration, deployment, test, or agent.
- Shadow comparison lasts 7–14 complete calendar days and requires explicit owner approval.
- No production deployment changes amoCRM or the original Sheet.

---

### Task 1: Persist targets, mappings, publication attempts, alerts, and controls

**Files:**
- Create: `supabase/migrations/0007_sheet_publication_and_alerts.sql`
- Create: `packages/db/src/sheets.ts`
- Create: `packages/db/src/alerts.ts`
- Test: `packages/db/src/sheets.integration.test.ts`
- Test: `packages/db/src/alerts.integration.test.ts`

**Interfaces:**
- Consumes: admin actor, spreadsheet copy ID, layout metadata, snapshot ID.
- Produces: `sheet_targets`, `sheet_layout_mappings`, `sheet_publications`, `system_alerts`, and repositories with one-active-target/one-open-alert invariants; consumes the disabled `system_controls` created in migration 0001.

- [ ] **Step 1: Write failing uniqueness and immutability tests**

```ts
it("allows one successful publication per target and snapshot", async () => {
  await publications.recordSuccess({ targetId, snapshotId, attempt: 1, checksum: "abc" });
  await expect(publications.recordSuccess({ targetId, snapshotId, attempt: 2, checksum: "abc" }))
    .rejects.toThrow(/unique/i);
});

it("starts both database controls disabled after reset", async () => {
  expect(await controls.get("sync_enabled")).toMatchObject({ enabled: false });
  expect(await controls.get("sheet_publish_enabled")).toMatchObject({ enabled: false });
});
```

- [ ] **Step 2: Run tests and verify missing relations**

Run: `pnpm test:integration -- packages/db/src/sheets.integration.test.ts packages/db/src/alerts.integration.test.ts`

Expected: FAIL because Sheet/alert relations do not exist.

- [ ] **Step 3: Add exact M9/M10 schema and partial unique indexes**

```sql
create type sheet_target_status as enum ('draft', 'validated', 'active', 'disabled');
create type sheet_report_kind as enum ('channels_daily', 'plan_fact');
create type sheet_value_type as enum ('integer', 'money', 'percent', 'date', 'text');

create table sheet_targets (
  id uuid primary key default gen_random_uuid(),
  spreadsheet_id text not null unique,
  expected_title text not null,
  status sheet_target_status not null default 'draft',
  layout_fingerprint text,
  validated_at timestamptz,
  activated_by uuid references app_users(id),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index one_active_sheet_target on sheet_targets ((status)) where status = 'active';

create table sheet_layout_mappings (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references sheet_targets(id),
  report_kind sheet_report_kind not null,
  logical_field text not null,
  sheet_name text not null,
  range_a1 text not null,
  value_type sheet_value_type not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (target_id, report_kind, logical_field),
  unique (target_id, sheet_name, range_a1)
);

create type publication_status as enum ('running', 'success', 'failed', 'blocked');

create table sheet_publications (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  target_id uuid not null references sheet_targets(id),
  snapshot_id uuid not null references metric_snapshots(id),
  attempt integer not null check (attempt > 0),
  status publication_status not null default 'running',
  layout_fingerprint text not null,
  payload_checksum text not null,
  cells_planned integer not null check (cells_planned >= 0),
  cells_written integer not null default 0 check (cells_written >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_summary text,
  unique (target_id, snapshot_id, attempt)
);

create unique index one_successful_snapshot_publication
  on sheet_publications (target_id, snapshot_id)
  where status = 'success';

create type alert_severity as enum ('info', 'warning', 'critical');
create type alert_status as enum ('open', 'acknowledged', 'resolved');

create table system_alerts (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  source text not null,
  code text not null,
  severity alert_severity not null,
  status alert_status not null default 'open',
  safe_summary text not null,
  safe_context jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references app_users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create unique index system_alerts_one_open_idx
  on system_alerts (source, code)
  where status = 'open';
```

Enable RLS on all four tables. Admin/head receive SELECT policies; manager receives none. Mutations run through server repositories after explicit admin or `sheet_publisher` authorization. `sheet_publisher` may read the active target, its mappings, and an approved snapshot and may insert/update only its own publication row; it cannot read OAuth/raw tables or change `system_controls`. Migration 0007 asserts that both rows in `system_controls` exist and are false, but does not recreate or enable them.

- [ ] **Step 4: Verify constraints, RLS, and disabled defaults**

Run: `supabase db reset && pnpm test:integration -- packages/db/src/sheets.integration.test.ts packages/db/src/alerts.integration.test.ts && pnpm test:security`

Expected: PASS; manager cannot access target/mapping/alert rows; duplicate success is rejected; open alert deduplicates by code/resource; switches remain false.

- [ ] **Step 5: Commit publication and operations schema**

```bash
git add supabase/migrations/0007_sheet_publication_and_alerts.sql packages/db
git commit -m "feat: add safe publication and alert persistence"
```

### Task 2: Block the original Sheet before Google client construction

**Files:**
- Create: `packages/integrations/src/google/policy.ts`
- Create: `packages/integrations/src/google/client.ts`
- Create: `packages/integrations/src/google/policy.test.ts`
- Create: `packages/integrations/src/google/client.integration.test.ts`
- Modify: `packages/domain/src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: target spreadsheet ID, environment/DB controls, service-account JSON from secret store, injected Google client factory.
- Produces: `assertWritableSpreadsheetId(id)`, `createSheetReadClient(context)`, `createSheetWriteClient(context)`, `PROTECTED_SPREADSHEET_IDS`, and `E_SHEET_PROTECTED`.

- [ ] **Step 1: Write failing zero-client/zero-request security tests**

```ts
const ORIGINAL_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";

it("rejects the original before credentials or client factory are read", async () => {
  const harness = googleHarness({ envEnabled: true, dbEnabled: true });
  await expect(harness.openWriter(ORIGINAL_ID)).rejects.toThrow("E_SHEET_PROTECTED");
  expect(harness.secretReads).toBe(0);
  expect(harness.clientCreations).toBe(0);
  expect(harness.requests).toHaveLength(0);
});

it.each([[false, true], [true, false], [false, false]])("requires both switches", async (envEnabled, dbEnabled) => {
  const harness = googleHarness({ envEnabled, dbEnabled });
  await expect(harness.openWriter(COPY_ID)).rejects.toThrow("E_FORBIDDEN");
  expect(harness.clientCreations).toBe(0);
});
```

- [ ] **Step 2: Run focused tests and verify policy is missing**

Run: `pnpm vitest run packages/integrations/src/google/policy.test.ts packages/integrations/src/google/client.integration.test.ts`

Expected: FAIL on missing Google policy modules.

- [ ] **Step 3: Implement immutable denylist and dual gate**

```ts
export const PROTECTED_SPREADSHEET_IDS = Object.freeze(new Set([
  "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks",
]));

export function assertWritableSpreadsheetId(id: string): string {
  const normalized = z.string().regex(/^[A-Za-z0-9_-]{20,}$/).parse(id.trim());
  if (PROTECTED_SPREADSHEET_IDS.has(normalized)) throw new AppError("E_SHEET_PROTECTED", 403);
  if (normalized !== env.GOOGLE_TARGET_SPREADSHEET_ID) throw new AppError("E_FORBIDDEN", 403);
  return normalized;
}

export async function createSheetReadClient(context: SheetContext): Promise<SheetClient> {
  const id = assertWritableSpreadsheetId(context.spreadsheetId);
  return context.factory(await secrets.readGoogleServiceAccount(), id, { access: "read" });
}

export async function createSheetWriteClient(context: PublicationContext): Promise<SheetClient> {
  const id = assertWritableSpreadsheetId(context.spreadsheetId);
  if (!env.SHEET_PUBLISH_ENABLED || !(await controls.isEnabled("sheet_publish_enabled"))) {
    throw new AppError("E_FORBIDDEN", 403, "Публикация отключена");
  }
  return context.factory(await secrets.readGoogleServiceAccount(), id, { access: "write" });
}
```

The integration package owns all Google API imports. The metadata validator uses `createSheetReadClient`; only the publisher imports and calls `createSheetWriteClient`. The service account scope is limited to Sheets API, and repository docs require access only to the copy.

- [ ] **Step 4: Prove environment cannot override protection**

Run: `pnpm vitest run packages/integrations/src/google && pnpm test:security`

Expected: PASS for original ID in request, DB, environment target, whitespace form, and alternate admin record; every protected case has zero credential reads/client creations/requests.

- [ ] **Step 5: Commit the Sheet target security boundary**

```bash
git add packages/integrations/src/google packages/domain/src/env.ts .env.example tests/security
git commit -m "feat: protect original Google Sheet from writes"
```

### Task 3: Validate copy layout and explicit range mappings

**Files:**
- Create: `packages/integrations/src/google/layout.ts`
- Create: `packages/integrations/src/google/layout.test.ts`
- Create: `packages/domain/src/sheets/mapping.ts`
- Create: `packages/domain/src/sheets/mapping.test.ts`
- Create: `apps/web/src/app/api/sheets/targets/route.ts`
- Create: `apps/web/src/app/api/sheets/targets/[id]/validate/route.ts`
- Create: `apps/web/src/app/api/sheets/targets/[id]/activate/route.ts`
- Create: `apps/web/src/app/api/sheets/mappings/route.ts`
- Create: `apps/web/src/app/settings/google-sheet/page.tsx`
- Test: `apps/web/src/app/api/sheets/targets/targets.integration.test.ts`

**Interfaces:**
- Consumes: admin-entered copy ID and read-only spreadsheet metadata/headers.
- Produces: `computeLayoutFingerprint(metadata)`, `validateMapping(candidate, layout)`, transactionally replaced target mappings, and M9.3 configuration endpoints.

- [ ] **Step 1: Write failing mapping overlap and expected-sheet tests**

```ts
it("requires the two known September sheet names on initial validation", () => {
  const result = validateInitialLayout(layoutFixture({ sheetNames: ["каналы сентябрь 2026"] }));
  expect(result).toEqual({ valid: false, missingSheets: ["выполнение плана сентябрь 2026"] });
});

it("rejects overlapping output ranges", () => {
  const candidate = mappingFixture([
    { field: "daily.leads", range: "A2:B31" },
    { field: "daily.applications", range: "B2:C31" },
  ]);
  expect(() => validateMapping(candidate, layoutFixture())).toThrow("E_SHEET_LAYOUT_MISMATCH");
});
```

- [ ] **Step 2: Run focused tests and verify missing validators**

Run: `pnpm vitest run packages/integrations/src/google/layout.test.ts packages/domain/src/sheets/mapping.test.ts`

Expected: FAIL because layout/mapping modules do not exist.

- [ ] **Step 3: Implement canonical fingerprint and exact mappings**

```ts
export function computeLayoutFingerprint(meta: SafeSpreadsheetMetadata): string {
  const canonical = meta.sheets
    .map((sheet) => ({ id: sheet.id, title: sheet.title, rows: sheet.rows, columns: sheet.columns, headers: sheet.headers }))
    .sort((a, b) => a.id - b.id);
  return sha256(stableStringify(canonical));
}
```

Mappings identify report kind, logical field, exact sheet name, A1 range, value type, and required flag. Validation rejects missing fields, unexpected dimensions, formula destinations, overlaps, wrong row/column counts, and use of tab position instead of the saved sheet name. `PUT /api/sheets/mappings` validates the complete candidate first, then replaces all mappings for the draft/validated target in one transaction; active mappings cannot change until the target returns to `validated` status.

- [ ] **Step 4: Verify target lifecycle and no-write validation**

Run: `pnpm vitest run packages/integrations/src/google/layout.test.ts packages/domain/src/sheets/mapping.test.ts && pnpm test:integration -- apps/web/src/app/api/sheets/targets/targets.integration.test.ts`

Expected: PASS; draft validation uses metadata/header reads only; activation requires exact fingerprint and complete mapping; layout changes block publication and set the target to `disabled`.

- [ ] **Step 5: Commit copy validation and mapping UI**

```bash
git add packages/integrations/src/google/layout.ts packages/integrations/src/google/layout.test.ts packages/domain/src/sheets apps/web/src/app/api/sheets apps/web/src/app/settings/google-sheet
git commit -m "feat: validate explicit Google Sheet copy layout"
```

### Task 4: Preview, publish in one batch, and verify by checksum

**Files:**
- Create: `packages/domain/src/sheets/payload.ts`
- Create: `packages/domain/src/sheets/payload.test.ts`
- Create: `packages/integrations/src/google/publisher.ts`
- Create: `packages/integrations/src/google/publisher.integration.test.ts`
- Create: `apps/worker/src/jobs/publish-sheet.ts`
- Create: `apps/worker/src/jobs/publish-sheet.integration.test.ts`
- Create: `apps/worker/src/schedules/sheet-publication.ts`
- Create: `apps/web/src/app/api/sheet-publications/route.ts`
- Create: `apps/web/src/app/sheet-publications/page.tsx`

**Interfaces:**
- Consumes: active validated target/mapping and one approved snapshot.
- Produces: `buildSheetPayload(snapshot, mapping)`, `previewPublication`, `publishSnapshot(snapshotId, targetId): PublicationResult`, request checksum, and publication history.

- [ ] **Step 1: Write failing original-ID, layout-drift, and checksum tests**

```ts
it("builds one batch from one snapshot and verifies all mapped values", async () => {
  const result = await publishSnapshot(snapshot42.id, activeCopy.id);
  expect(google.requests.filter((request) => request.kind === "batchUpdate")).toHaveLength(1);
  expect(result).toMatchObject({ status: "success", snapshotVersion: 42, checksum: expectedChecksum });
});

it("does not write when preflight fingerprint changed", async () => {
  google.metadata = layoutWithMovedHeader;
  await expect(publishSnapshot(snapshot42.id, activeCopy.id)).rejects.toThrow("E_SHEET_LAYOUT_MISMATCH");
  expect(google.requests.filter((request) => request.kind === "batchUpdate")).toHaveLength(0);
});
```

- [ ] **Step 2: Run publisher tests and verify missing function**

Run: `pnpm test:integration -- packages/integrations/src/google/publisher.integration.test.ts apps/worker/src/jobs/publish-sheet.integration.test.ts`

Expected: FAIL because `publishSnapshot` does not exist.

- [ ] **Step 3: Implement the fail-closed publication sequence**

```ts
export async function publishSnapshot(snapshotId: string, targetId: string): Promise<PublicationResult> {
  const context = await publications.prepare(snapshotId, targetId);
  const client = await createSheetWriteClient(context);
  const payload = buildSheetPayload(context.snapshot, context.mapping);
  const checksum = sha256(stableStringify(payload.values));
  const attempt = await publications.start({
    targetId,
    snapshotId,
    layoutFingerprint: context.target.layoutFingerprint,
    payloadChecksum: checksum,
    cellsPlanned: payload.cellCount,
    traceId: context.traceId,
  });
  try {
    const metadata = await client.readMetadataAndHeaders();
    assertFingerprint(context.target.layoutFingerprint, computeLayoutFingerprint(metadata));
    await client.batchUpdate(payload.requests);
    const observed = await client.readMappedRanges(payload.ranges);
    if (sha256(stableStringify(observed)) !== checksum) {
      await controls.disable("sheet_publish_enabled", "post-write checksum mismatch");
      throw new AppError("E_SHEET_UPSTREAM", 502);
    }
    return publications.finishSuccess(attempt.id, checksum, payload.cellCount);
  } catch (error) {
    await publications.finishFailure(attempt.id, classifyPublicationError(error));
    throw error;
  }
}
```

The worker schedule polls for a new approved snapshot after each successful snapshot job and invokes publication only when an active target exists and both switches are true; it performs no credential read when disabled. Retries use fake-clock-tested delays 1, 3, 9, 27, and 60 seconds for 429/5xx. A prior successful `(target,snapshot)` returns its recorded result without a second write. A failed attempt keeps prior Sheet values and creates a critical alert; automatic publication remains disabled after checksum failure.

- [ ] **Step 4: Verify retries, duplicate invocation, partial errors, and read-back**

Run: `pnpm vitest run packages/domain/src/sheets/payload.test.ts && pnpm test:integration -- packages/integrations/src/google/publisher.integration.test.ts apps/worker/src/jobs/publish-sheet.integration.test.ts && pnpm test:security`

Expected: PASS; one batch per new snapshot; duplicate success makes no request; layout/checksum failures block and alert; only mapped ranges are present in batch requests.

- [ ] **Step 5: Commit preview and publisher**

```bash
git add packages/domain/src/sheets packages/integrations/src/google/publisher.ts packages/integrations/src/google/publisher.integration.test.ts apps/worker/src/jobs/publish-sheet.ts apps/worker/src/jobs/publish-sheet.integration.test.ts apps/web/src/app/api/sheet-publications apps/web/src/app/sheet-publications
git commit -m "feat: publish verified snapshots to approved Sheet copy"
```

### Task 5: Add readiness, status, alerts, freshness, and runtime disablement

**Files:**
- Create: `packages/domain/src/operations/status.ts`
- Create: `packages/db/src/system-status.ts`
- Create: `apps/worker/src/jobs/health-checks.ts`
- Create: `apps/worker/src/jobs/health-checks.test.ts`
- Create: `apps/worker/src/alerts/email.ts`
- Create: `apps/web/src/app/api/health/ready/route.ts`
- Create: `apps/web/src/app/api/system/status/route.ts`
- Create: `apps/web/src/app/api/alerts/route.ts`
- Create: `apps/web/src/app/api/alerts/[id]/acknowledge/route.ts`
- Create: `apps/web/src/app/system/page.tsx`
- Test: `apps/web/src/app/api/health/ready/route.integration.test.ts`

**Interfaces:**
- Consumes: DB reachability, active config, current snapshot, sync/publication history, open issues/alerts, SMTP secret.
- Produces: liveness/readiness/system/alert APIs, `evaluateSystemHealth(now)`, deduplicated alerts, and redacted email notifications.

- [ ] **Step 1: Write failing last-good and readiness tests**

```ts
it("serves the last approved snapshot as stale when amoCRM sync fails", async () => {
  await seedApprovedSnapshot({ version: 42, sourceFreshAt: minutesAgo(25) });
  await seedFailedSync({ finishedAt: minutesAgo(2) });
  const status = await evaluateSystemHealth(now);
  expect(status.dashboard).toEqual({ available: true, snapshotVersion: 42, stale: true });
  expect(status.alerts.map((alert) => alert.code)).toContain("sync_stale");
});

it("returns ready only with DB, active config, and approved snapshot", async () => {
  const response = await readyRoute();
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toMatch(/DATABASE_URL|token|postgres:\/\//i);
});
```

- [ ] **Step 2: Run health tests and verify missing evaluator/routes**

Run: `pnpm vitest run apps/worker/src/jobs/health-checks.test.ts apps/web/src/app/api/health/ready/route.integration.test.ts`

Expected: FAIL because system health modules do not exist.

- [ ] **Step 3: Implement safe status and thresholded alerts**

Open/dedupe alerts for sync freshness over 10 minutes, five consecutive sync failures, OAuth expiry/refresh failure, source count drop over 5%, blocking quality issue, missing current snapshot, Sheet layout drift, and checksum mismatch. Email includes environment, code, severity, first/last seen, trace ID, and runbook link only. JSON application logs have a 30-day retention policy; `system_alerts` records have a one-year retention job that preserves unresolved incidents.

```ts
export type Readiness = {
  ready: boolean;
  checks: { database: boolean; activeConfig: boolean; currentSnapshot: boolean };
};
```

Public readiness returns only `{ ready }`; authenticated system status returns safe detailed booleans and timestamps. Acknowledgement records admin/time without resolving the underlying condition.

- [ ] **Step 4: Verify deduplication, recovery, safe email, and stale dashboard**

Run: `pnpm vitest run apps/worker/src/jobs/health-checks.test.ts && pnpm test:integration -- apps/web/src/app/api/health/ready/route.integration.test.ts && pnpm test:security`

Expected: PASS; repeated checks update one open alert; recovery resolves it; failed upstream does not delete/zero the current snapshot.

- [ ] **Step 5: Commit operational health and alerts**

```bash
git add packages/domain/src/operations packages/db/src/system-status.ts apps/worker/src/jobs/health-checks.ts apps/worker/src/jobs/health-checks.test.ts apps/worker/src/alerts apps/web/src/app/api/health/ready apps/web/src/app/api/system apps/web/src/app/api/alerts apps/web/src/app/system
git commit -m "feat: monitor freshness and preserve last good data"
```

### Task 6: Package deployment, backups, restore, and incident procedures

**Files:**
- Create: `deploy/Caddyfile`
- Create: `deploy/docker-compose.production.yml`
- Create: `scripts/check-deployment-config.mjs`
- Create: `scripts/verify-backup-restore.sh`
- Create: `docs/runbooks/deployment.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/incident-response.md`
- Create: `docs/runbooks/sheet-publication-disable.md`
- Test: `tests/repo/deployment-config.test.mjs`

**Interfaces:**
- Consumes: reviewed images, secret-store references, Supabase connection, HTTPS domain, SMTP configuration.
- Produces: reproducible `web`/`worker` deployment behind Caddy, configuration validator, restore rehearsal, and explicit disable/recovery procedures.

- [ ] **Step 1: Write failing production-config safety test**

```js
test("production compose never enables network switches by default", async () => {
  const compose = await readFile("deploy/docker-compose.production.yml", "utf8");
  assert.doesNotMatch(compose, /SYNC_ENABLED:\s*["']?true/i);
  assert.doesNotMatch(compose, /SHEET_PUBLISH_ENABLED:\s*["']?true/i);
  assert.doesNotMatch(compose, /123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks/);
});
```

- [ ] **Step 2: Run the test and verify deployment files are missing**

Run: `node --test tests/repo/deployment-config.test.mjs`

Expected: FAIL with missing production Compose file.

- [ ] **Step 3: Implement HTTPS deployment and exact runbooks**

```yaml
# deploy/docker-compose.production.yml
services:
  web:
    image: ${REAL2_WEB_IMAGE:?image digest required}
    restart: unless-stopped
    env_file: [/etc/real2/web.env]
    read_only: true
    security_opt: ["no-new-privileges:true"]
  worker:
    image: ${REAL2_WORKER_IMAGE:?image digest required}
    restart: unless-stopped
    env_file: [/etc/real2/worker.env]
    read_only: true
    security_opt: ["no-new-privileges:true"]
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
```

The deployment runbook targets an Ubuntu 24.04 LTS host with Docker, firewall ports 22/80/443, non-root deploy user, pinned image digests, and secret files mode 0600. It configures an external uptime monitor for `GET /api/health/live` and an authenticated freshness monitor for safe system status without embedding credentials in a URL. Restore rehearsal downloads a Supabase backup into an isolated local database, applies no production writes, runs migrations/checks, and verifies golden snapshot checksum within the four-hour RTO.

- [ ] **Step 4: Validate Compose, secret references, and restore rehearsal**

Run: `node --test tests/repo/deployment-config.test.mjs && node scripts/check-deployment-config.mjs deploy/docker-compose.production.yml && docker compose -f deploy/docker-compose.production.yml config && bash scripts/verify-backup-restore.sh --fixture packages/testkit/fixtures/backup.sql`

Expected: all commands exit 0; no secret value is printed; restored DB passes migration version and golden checksum checks.

- [ ] **Step 5: Commit operations package**

```bash
git add deploy scripts tests/repo/deployment-config.test.mjs docs/runbooks
git commit -m "ops: add reversible deployment and restore procedures"
```

### Task 7: Run shadow reconciliation and prepare explicit production gates

**Files:**
- Create: `packages/domain/src/reconciliation/manual-report.ts`
- Create: `packages/domain/src/reconciliation/compare.ts`
- Create: `packages/domain/src/reconciliation/compare.test.ts`
- Create: `apps/worker/src/jobs/reconcile-manual-report.ts`
- Create: `apps/web/src/app/reconciliation/page.tsx`
- Create: `docs/runbooks/shadow-acceptance.md`
- Create: `docs/runbooks/production-go-live.md`
- Create: `docs/runbooks/release-evidence/.gitkeep`

**Interfaces:**
- Consumes: user-exported CSV from the manually maintained report and same-day approved snapshot rows; no API access to the original Sheet.
- Produces: `compareManualReport(manual, snapshot): ReconciliationResult`, per-day/manager/channel differences, signed acceptance checklist, and separate sync/publication enable procedures.

- [ ] **Step 1: Write a failing exact-difference test**

```ts
it("reports exact count and kopeck differences without hiding missing rows", () => {
  const result = compareManualReport(
    [{ date: "2026-09-05", manager: "Патя", leads: 10, applications: 4, payments: 2, revenueRub: "20000.00" }],
    [{ date: "2026-09-05", manager: "Патя", leads: 10, applications: 5, payments: 2, revenueRub: "19999.99" }],
  );
  expect(result.rows[0].difference).toEqual({ leads: 0, applications: 1, payments: 0, revenueRub: "-0.01" });
  expect(result.accepted).toBe(false);
});
```

- [ ] **Step 2: Run the test and verify comparator is missing**

Run: `pnpm vitest run packages/domain/src/reconciliation/compare.test.ts`

Expected: FAIL because reconciliation modules do not exist.

- [ ] **Step 3: Implement strict CSV parsing and comparison**

```ts
export type ReconciliationDifference = {
  leads: number;
  applications: number;
  payments: number;
  revenueRub: string;
};

export function isZeroDifference(value: ReconciliationDifference): boolean {
  return value.leads === 0 && value.applications === 0 && value.payments === 0 && new Decimal(value.revenueRub).isZero();
}
```

Parser accepts the explicitly documented Russian headers and ISO/approved Russian date forms, rejects duplicate keys and formula cells, and preserves source filename/hash. Comparison covers daily totals, managers, and channels. A difference may be closed only with a linked lead-level explanation and owner decision; expected output is not silently rewritten.

- [ ] **Step 4: Execute the non-production shadow process**

Run automated checks and deploy with both switches false. The owner—not an implementation agent—completes external OAuth installation and explicitly performs the reviewed staging sync-enablement procedure; Sheet publication remains false. For each of 7–14 full days, import the owner-provided CSV export and record reconciliation evidence. Re-run forbidden-method and protected-ID tests after the final deployment image is built.

Expected: each accepted day has zero unexplained difference for leads, applications, payments, revenue, manager, and channel; dashboard freshness is within ten minutes for at least 95% of observed time.

- [ ] **Step 5: Record a production recommendation without enabling publication**

```bash
git add packages/domain/src/reconciliation apps/worker/src/jobs/reconcile-manual-report.ts apps/web/src/app/reconciliation docs/runbooks
git commit -m "ops: document REAL2 shadow acceptance evidence"
```

The release verifier returns GO only with passing evidence, a restore rehearsal, written amoCRM support confirmation, and signed owner acceptance. A GO result authorizes a separate human-run change window; it does not itself turn on `sheet_publish_enabled` or alter credentials.

## Plan 5 completion gate

Before any first write to the copy, independently verify:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm test:e2e
pnpm build
node scripts/check-deployment-config.mjs deploy/docker-compose.production.yml
```

Then verify the target ID verbally and in the release record, confirm it differs from the protected ID, confirm the service account cannot see the original, and obtain written owner approval. The first publication is supervised, immediately read back, checksummed, and reversible by disabling either publication switch while keeping the last successful values.
