# Task 5 report — append-only amoCRM raw synchronization journal

## Summary

- Added ordered migration `0005_raw_sync.sql` (migrations `0001`–`0004` were already occupied) for sync runs, durable cursors, minimal page metadata, raw amoCRM objects/events, malformed-page quarantine, and safe API audit rows.
- Added service-worker repositories for starting and atomically finishing runs, advancing cursors only on `success`, idempotently appending pages/objects/events, quarantining malformed pages, persisting the safe audit shape, and aggregating exact source-field values from the latest successful raw lead snapshots.
- Added Zod contracts for account, pipeline/status, user, lead, and event responses. Entity schemas retain unknown upstream fields for the raw journal while requiring stable identity and ordering fields.
- Completed the deferred `GET /api/config/channel-values` contract with truthful raw-derived counts; partial/failed runs are excluded and later successful lead snapshots supersede older values.
- Preserved the read-only boundary: no production HTTP/OAuth/Google code changed, both external switches remain disabled, and all evidence used synthetic local fixtures.

## Files

- `.superpowers/sdd/2026-09-12-02-amo-readonly-sync/task-5-report.md`
- `supabase/migrations/0005_raw_sync.sql`
- `packages/db/src/sync-runs.ts`
- `packages/db/src/raw-amo.ts`
- `packages/db/src/raw-amo.integration.test.ts`
- `packages/db/src/index.ts`
- `packages/integrations/src/amo/schemas.ts`
- `packages/integrations/src/amo/schemas.test.ts`
- `packages/integrations/src/index.ts`
- `apps/web/src/app/api/config/channel-values/route.ts`
- `apps/web/src/app/api/config/config.integration.test.ts`
- `tests/security/rls.security.test.ts`

## Data and transaction guarantees

- `sync_runs` pins a unique trace ID, one connection, one immutable configuration version, kind, terminal outcome, safe counters/error fields, checksum, and timestamps.
- `sync_pages` stores only run, stream, positive page number, non-negative item count, SHA-256, and receive time. It stores no URL, query value, request body, or duplicate raw payload.
- Raw objects are unique per `(sync_run_id, entity_type, external_id)`; events are unique per `(account_id, amo_event_id)` across repeated runs; quarantine rows are unique per run/stream/page/hash.
- Replaying identical pages/entities is a no-op. Reusing a page or event identity with a different hash raises `E_CONFLICT`, and the page transaction rolls back rather than mixing versions.
- `finishSyncRun` row-locks the running run and writes its terminal outcome and successful cursor updates in one transaction. Partial and failed outcomes retain diagnostics but never advance cursors.
- `getRawChannelValues` considers only successful runs, selects the latest successful raw snapshot per lead, counts each exact value once per lead, ignores malformed/non-scalar/empty values, and returns deterministic count/value ordering.

## Access and retention boundary

- RLS is enabled on every new table; anonymous access remains absent.
- Admin/head can read safe run/page/audit evidence. Only admin can read raw objects, events, and quarantine through authenticated RLS. Managers see no rows. Authenticated users cannot read durable cursors or write journal tables.
- `service_worker` can insert/read journal data, update only terminal run fields/counters and cursor values, and cannot rewrite a run's pinned trace/connection/config identity.
- Neither `service_worker` nor a user-facing role has raw `UPDATE` or `DELETE`. This is the retention boundary: Task 6's separately reviewed 90-day retention operation must preserve hashes and normalized history before receiving any deletion path; ordinary sync credentials cannot delete raw evidence.

## TDD evidence

### RED

1. New response-schema tests failed because `packages/integrations/src/amo/schemas.ts` did not exist.
2. New raw-journal integration tests failed because `raw-amo.ts` and `sync-runs.ts` did not exist.
3. The pinned-run-identity test failed because the interrupted migration granted whole-table `UPDATE` to `service_worker` (`promise resolved "[]" instead of rejecting`).
4. The channel-values route test failed with `{ configVersion: 1, values: [] }` despite three successful raw lead fixtures.
5. The first full unit run exposed missing teardown in the new RLS suite: retained synthetic config rows caused 15 OAuth cleanup FK failures. Symmetric teardown fixed the isolation defect.

### GREEN

- Repository/worker Node tests: 12/12 passed.
- Unit: 80/80 passed across 14 files, including 4 new synchronization response-schema tests.
- Integration: 52/52 passed across 6 files, including 7 new raw-journal repository tests and the raw-backed channel-values route test.
- Security: 17/17 passed across RLS and safe-log suites, including admin/head/manager raw journal visibility and direct-write denial.
- Contracts: command exited 0 with `--passWithNoTests`; no contract files exist yet.
- Local Supabase reset applied migrations `0001` through `0005` successfully on the configured PostgreSQL 17 stack.
- Lint, TypeScript checks, production build, tracked-secret scan, and `git diff --check` all exited 0.

## Final verification commands

All package commands ran with Node `v22.23.2` and pnpm `10.34.5`:

```text
supabase db reset
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm build
pnpm check:secrets
git diff --check
```

## Self-review and follow-up boundary

- No live amoCRM host was called, no token or credential was read, no OAuth setting changed, no Google API was used, and the protected original spreadsheet was untouched.
- The migration deliberately does not grant raw deletion to the normal worker. The retention job, watchdog, pagination/retry orchestration, schedules, sync APIs, and sync screens remain Task 6 ownership.
- Response schemas are raw-ingestion contracts, not normalized business models. They preserve additional upstream keys so later normalization can be replayed without changing the journal.
