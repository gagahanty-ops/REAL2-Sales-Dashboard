# Task 5 report — append-only amoCRM raw synchronization journal

## Summary

- Added ordered migration `0005_raw_sync.sql` (migrations `0001`–`0004` were already occupied) for sync runs, durable cursors, minimal page metadata, raw amoCRM objects/events, malformed-page quarantine, and safe API audit rows.
- Added service-worker repositories for starting and atomically finishing runs, advancing cursors only on `success`, idempotently appending pages/objects/events, quarantining malformed pages, persisting the safe audit shape, and aggregating exact source-field values from the latest successful raw lead snapshots.
- Added Zod contracts for account, pipeline/status, user, lead, and event responses. Entity schemas retain unknown upstream fields for the raw journal while requiring stable identity and ordering fields.
- Completed the deferred `GET /api/config/channel-values` contract with truthful raw-derived counts; partial/failed runs are excluded and later successful lead snapshots supersede older values.
- Closed fix-round review findings across the contract and implementation: event IDs/cursors are opaque bounded strings, complex official custom-field values remain ingestible, terminal runs are sealed at the database boundary, cursor advancement has one atomic finalizer, durable audit paths are canonicalized, and exact channel values remain whitespace-distinct.
- Recorded specification version 1.0.2 as a review-verified technical correction based on the official amoCRM Events API. It is explicitly **not** recorded as a new project-owner approval.
- Preserved the read-only boundary: no production HTTP/OAuth/Google code changed, both external switches remain disabled, and all evidence used synthetic local fixtures.

## Files

- `.superpowers/sdd/2026-09-12-02-amo-readonly-sync/task-5-report.md`
- `supabase/migrations/0005_raw_sync.sql`
- `SPEC.md`
- `METRICS_CATALOG.md`
- `docs/spec-first/APPROVALS.md`
- `docs/superpowers/plans/2026-09-12-02-amo-readonly-sync.md`
- `docs/superpowers/plans/2026-09-12-03-normalization-metrics.md`
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
- Raw objects are unique per `(sync_run_id, entity_type, external_id)`; events are unique per `(account_id, amo_event_id)` across repeated runs; quarantine rows are unique per run/stream/page/hash. Event IDs and cursor external IDs are preserved as opaque case-sensitive strings bounded to 1–128 characters, with no numeric conversion or inferred slug grammar.
- Replaying identical pages/entities is a no-op. Reusing a page or event identity with a different hash raises `E_CONFLICT`, and the page transaction rolls back rather than mixing versions.
- Every page/object/event/quarantine/audit insert linked to a run acquires a database key-share lock and requires that run to remain `running`. `app.finish_sync_run` takes the conflicting row lock, writes the terminal outcome, and advances successful cursors atomically, so an append cannot straddle the terminal seal in either lock order.
- `service_worker` has no direct run-update or cursor-write privilege; the security-definer finalizer is the sole scoped cursor-advancement path. Partial and failed outcomes retain diagnostics but cannot carry cursor updates.
- A database trigger maps audit paths to a closed allowlist of structural paths, replaces numeric lead/pipeline IDs with `:id`, and stores every unexpected, query-bearing, or free-text path as `/denied`.
- `getRawChannelValues` considers only successful runs, selects the latest successful raw snapshot per lead, counts each exact scalar value once per lead, ignores malformed/non-scalar/empty-string values, preserves leading/trailing whitespace, and returns deterministic count/value ordering.

## Access and retention boundary

- RLS is enabled on every new table; anonymous access remains absent.
- Admin/head can read safe run/page/audit evidence. Only admin can read raw objects, events, and quarantine through authenticated RLS. Managers see no rows. Authenticated users cannot read durable cursors or write journal tables.
- `service_worker` can create only a default-`running` run, insert/read journal data, and call the atomic finalizer. It cannot directly update any run field, create a forged terminal run, or insert/update a cursor.
- Neither `service_worker` nor a user-facing role has raw `UPDATE` or `DELETE`. This is the retention boundary: Task 6's separately reviewed 90-day retention operation must preserve hashes and normalized history before receiving any deletion path; ordinary sync credentials cannot delete raw evidence.

## TDD evidence

### RED

1. New response-schema tests failed because `packages/integrations/src/amo/schemas.ts` did not exist.
2. New raw-journal integration tests failed because `raw-amo.ts` and `sync-runs.ts` did not exist.
3. The pinned-run-identity test failed because the interrupted migration granted whole-table `UPDATE` to `service_worker` (`promise resolved "[]" instead of rejecting`).
4. The channel-values route test failed with `{ configVersion: 1, values: [] }` despite three successful raw lead fixtures.
5. The first full unit run exposed missing teardown in the new RLS suite: retained synthetic config rows caused 15 OAuth cleanup FK failures. Symmetric teardown fixed the isolation defect.
6. Fix-round opaque-ID tests failed against the inherited alphanumeric slug restriction for a bounded string such as `event:01/ABC.2`; removing the inferred grammar while preserving the 1–128 character bound made the schema, repository, cursor, and database contracts truly opaque.

### GREEN

- Repository/worker Node tests: 12/12 passed.
- Unit: 86/86 passed across 14 files, including 10 synchronization response-schema cases.
- Integration: 61/61 passed across 6 files, including 16 raw-journal repository cases and the raw-backed channel-values route test.
- Security: 18/18 passed across RLS and safe-log suites, including admin/head/manager/anonymous raw-event visibility boundaries and finalizer/direct-write denial.
- Contracts: command exited 0 with `--passWithNoTests`; no contract files exist yet.
- Local Supabase reset applied migrations `0001` through `0005` successfully on the configured PostgreSQL 17 stack.
- Lint, TypeScript checks, production build, tracked-secret scan, and `git diff --check` all exited 0.
- Focused red/green verification: response schemas 10/10 and raw journal 16/16 passed after the final opaque-ID correction and a fresh database reset.

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
- The only external lookup was the public official amoCRM developer documentation used to verify that Events API `id` is a string; no account endpoint, OAuth flow, or business-data API was contacted.
- The migration deliberately does not grant raw deletion to the normal worker. The retention job, watchdog, pagination/retry orchestration, schedules, sync APIs, and sync screens remain Task 6 ownership.
- Response schemas are raw-ingestion contracts, not normalized business models. They preserve additional upstream keys so later normalization can be replayed without changing the journal.
