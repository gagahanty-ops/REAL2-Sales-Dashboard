# Task 6 report — guarded amoCRM synchronization operations

## Summary

- Recovered and independently audited the uncommitted Task 6 diff on top of
  `30aa40c`; no existing tracked or untracked work was discarded.
- Added migration `0006_sync_operations.sql` and DB operational repositories
  for per-connection PostgreSQL advisory locking, safe run/history projections,
  cursor reads, full-run count comparison, stale-run sealing, and the
  proof-gated retention boundary.
- Implemented the guarded worker sync runner: both `SYNC_ENABLED` and the DB
  `system_controls.sync_enabled` must be true before a connection, token
  provider, lock, or amoCRM request is reached. It uses the sole guarded
  `amoFetch` transport, processes account/pipeline/status/user metadata before
  events and leads, validates every page before append, follows validated next
  links, rejects a repeated page checksum, and advances cursors only in the
  existing atomic successful finalizer.
- Incremental runs query a ten-minute overlap and retain stable `(event_at,
  amo_event_id)` cursor ordering. Retry behavior is deterministic under an
  injected clock: one refresh/retry for 401, then 1/3/9/27/60 second retries
  with bounded injected jitter for 429 and 5xx. Partial/failed runs retain safe
  diagnostics and cannot advance cursors or replace later production data.
- Added schedule helpers for five-minute incremental dispatch and the 02:30
  `Europe/Moscow` nightly reconciliation, a 20-minute watchdog, and a
  90-day raw-retention job. Retention is executable only by the separate
  `retention_worker` role through a security-definer function matching each
  raw hash to a retained normalized-history proof; normal worker and user
  roles receive no raw-delete permission.
- Added test-only synthetic amoCRM fixtures/server and exported them solely
  from `@real2/testkit`; production networking remains confined to
  `@real2/integrations` `amoFetch`.
- Added safe admin/head `GET /api/sync-runs` and `GET /api/sync-runs/{id}`
  projections, admin-only `POST /api/sync-runs`, and `/sync` / `/sync/{id}`
  screens. The manual button explicitly confirms a run begun in the preceding
  minute; a held advisory lock becomes `409 E_SYNC_LOCKED` before network use.
  The UI exposes only safe counters, page metadata, error summaries, and
  aggregate audit paths—never raw payloads, query values, or credentials.

## Recovery fixes

- The inherited diff omitted the required `/sync` and `/sync/{id}` pages and
  the manual trigger component; these were added with existing role and safe
  projection patterns.
- The web package was missing the installed workspace link to the worker
  entrypoint. Its lockfile dependency and Next transpilation configuration now
  compile the guarded worker entrypoint rather than relying on ignored stale
  build output.
- A fresh lint run found one unused `Database` type import in the inherited
  DB integration test; it was removed. No behavior changed for that fix.

## Fresh verification

All commands used Node `v22.23.2` from the required pinned runtime and pnpm
`10.34.5`. The database reset was local/synthetic only.

| Check | Evidence |
|---|---|
| Local schema | `supabase db reset` applied migrations `0001`–`0006` cleanly. |
| Focused Task 6 | 8 files / 29 tests passed: sync, schedule, watchdog, retention, mock server, guarded transport, sync API, and manual trigger. |
| Repository + unit | `pnpm test`: 12 repository/worker TAP tests and 99 unit tests passed. |
| Integration | `pnpm test:integration`: 8 files / 73 tests passed, including 4 operational DB tests and 5 safe sync-route tests. |
| Security | `pnpm test:security`: 18 tests passed. |
| Contracts | `pnpm test:contracts` exited 0 with no contract files. |
| Static/build | `pnpm lint`, `pnpm typecheck`, and `pnpm build` all passed; build lists `/api/sync-runs`, `/api/sync-runs/[id]`, `/sync`, and `/sync/[id]`. |
| Hygiene | `pnpm check:secrets` and `git diff --check` passed. |

## Safety boundary

- No live amoCRM business request, OAuth action, Google request, credential
  lookup, protected spreadsheet operation, or switch enablement occurred.
- Both external switches remain false in the repository configuration.
- Task 5's append-only raw journal and atomic terminal/cursor seal remain the
  only ordinary sync write path; retention is separate and proof-gated.
