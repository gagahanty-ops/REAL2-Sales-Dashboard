# Task 6 report — guarded amoCRM synchronization operations

## Fix round 3/5 — 2026-09-16

Implemented from clean base commit
`37d240ab80c59e4b7756a05acf4b06dc75cc6624`.

This report intentionally replaces the earlier stale Task 6 write-up. It only
describes behavior present in this round's code and tests.

## What changed

1. Durable manual sync queue ownership is now explicit.
   `sync_work_queue` has a lease token, lease expiry, attempt counter, terminal
   error fields, and a retryable running state. `claimNextSyncWork` claims one
   row with `for update skip locked`, so concurrent workers cannot own the same
   item. `completeSyncWork` is fenced by the lease token and rejects stale
   completions. Expired leases are recoverable; exhausted jobs are durably
   failed instead of stranded. Queue correlation trace is stable while every
   retry creates a fresh unique sync-run trace. Only a successful sync is
   marked `done`; partial and failed runs persist a truthful failed queue state,
   real `sync_run_id`, safe error code, and safe summary.

2. Manual queue acceptance now preflights the same sync advisory lock used by
   the worker. If a run already owns the per-connection lock, `POST
   /api/sync-runs` returns `409 E_SYNC_LOCKED` before inserting queue work.

3. Queue traceability is propagated without violating sync-run uniqueness.
   Manual queue `trace_id` is stored as `correlation_trace_id`, each attempt has
   its own `sync_runs.trace_id`, and `requested_by` flows into `runSync`,
   `startSyncRun`, safe API projections, and the UI's created-by attribution.

4. The worker entrypoint is no longer a one-shot placeholder. Production CLI
   mode loops until process shutdown. Each iteration always runs independent
   maintenance first: OAuth stale-state purge, stale sync watchdog, and raw
   retention at the current fail-closed boundary. When sync is enabled by both
   switches, the iteration dispatches due five-minute incremental syncs, the
   02:30 `Europe/Moscow` nightly reconciliation, including catch-up after a
   missed 02:30 wake-up once per Moscow date, and the manual queue consumer.

5. Advisory-lock ownership is fenced before any sensitive continuation. The
   lock helper reserves one PostgreSQL session, exposes a `SyncLockFence`, and
   verifies the backend before and inside proactive token refresh, immediately
   before OAuth/account amoCRM network calls and token rotation, raw append,
   audit persistence, alert persistence, and terminal finalization. If the
   backend is lost or replaced, the runner raises `E_SYNC_FENCE_LOST` and does
   not continue work under an unfenced lock. Cleanup releases locks after nested
   failures; when PostgreSQL has already terminated the lock session, cleanup
   treats the advisory lock as already released.

6. Worker and retention database identities are distinct restricted logins.
   The migration creates/grants `service_worker` and `retention_worker`
   separately. Runtime clients now reject admin/postgres usernames, same worker
   and retention URLs, and any `connection.role`/`SET ROLE` escalation. Local
   integration helpers create restricted test passwords after reset for the
   synthetic database only.

7. Critical alert sink failures no longer leave a sync run running. Count-drop
   failure finalization now seals the run first and records safe alert-delivery
   failure text in the terminal run summary.

8. Partial/failed/count-drop outcomes preserve the diagnostics needed for
   follow-up: distinct lead counts remain in `counts.leadsRead`, and checksum
   diagnostics remain in the safe error summary instead of being overwritten by
   generic failure text.

9. Sync history now uses explicit `Europe/Moscow` formatting, exposes
   created-by attribution, and paginates history safely with previous/next page
   links.

## Safety boundaries preserved

- No live amoCRM, OAuth, Google, spreadsheet, or protected external request was
  made.
- Repository switches remain false; tests use synthetic local fixtures.
- The Task 5 append-only raw journal and terminal/cursor seal remain the normal
  sync write path.
- Retention remains fail-closed at zero raw deletes until a later Plan 3
  migration proves a concrete normalized evidence relation. This round does not
  fabricate retention proof.
- Production networking remains through the guarded `GET` amoCRM transport and
  external OAuth is still the only OAuth path.

## Regression coverage added

- Queue ownership, `skip locked` single-claim behavior, stale lease recovery,
  lease-token fencing, exhausted-job terminalization, fresh per-attempt trace
  IDs, and truthful success/partial/failed queue completion.
- Manual API `409 E_SYNC_LOCKED` before queue insertion while the same advisory
  lock is held.
- Queue consumer execution that creates a real terminal sync run using a fresh
  attempt trace plus the queued correlation trace/requester.
- Production worker recurrence for five-minute incremental sync, 02:30 Moscow
  nightly sync, queue consumption, watchdog, and fail-closed retention
  invocation.
- Actual PostgreSQL backend termination of the advisory-lock owning session:
  the fence trips with `E_SYNC_FENCE_LOST`, then another worker can acquire the
  lock.
- Nested failure cleanup release of advisory locks.
- Proactive OAuth refresh fencing before network validation and token rotation.
- Nightly reconciliation catch-up after 02:30 Moscow without duplicate dispatch.
- Restricted `service_worker` and `retention_worker` login requirements, same
  URL rejection, admin/postgres rejection, and no `SET ROLE` escalation.
- Alert-sink failure sealing, partial failure lead-count preservation, checksum
  diagnostics preservation, Moscow date formatting, history pagination, and
  created-by projection.

## Fresh verification evidence

All final commands were run locally with:

- Node: `v22.23.2`
- pnpm: `10.34.5`
- PATH prefix:
  `/Users/arlandorizzi/.npm/_npx/d8d805b81e5239f8/node_modules/.bin:/Users/arlandorizzi/.npm/_npx/d8d805b81e5239f8/node_modules/node/bin`

| Check | Evidence |
|---|---|
| Local schema | `supabase db reset` applied migrations `0001` through `0009` cleanly. |
| Focused Task 6 unit/UI/OAuth | focused unit suites: 31 tests passed. |
| Focused Task 6 DB/API | focused integration suites: 15 tests passed, including actual backend-termination fencing, queue retry correlation, exhaustion, and terminal status. |
| Worker/repo TAP | focused worker/container TAP: 12 tests passed. |
| Repository + unit | `pnpm test`: 16 TAP tests and 110 unit tests passed. |
| Integration | `pnpm test:integration`: 8 files / 80 tests passed. |
| Security | `pnpm test:security`: 2 files / 18 tests passed. |
| Contracts | `pnpm test:contracts`: exited 0 with no matching contract files. |
| Static analysis | `pnpm lint` and `pnpm typecheck` passed. |
| Production build | `pnpm build` passed for all app/package workspaces and generated `/api/sync-runs`, `/api/sync-runs/[id]`, `/sync`, and `/sync/[id]`. |
| Hygiene | `pnpm check:secrets` and `git diff --check` passed. |

## Notes for the next plan

- Raw retention is intentionally still zero-delete/fail-closed. Plan 3 must add
  the normalized evidence relation before any delete-positive retention proof is
  valid.
- The actual backend-termination regression is intentionally scoped to the DB
  lock primitive. End-to-end runner coverage separately verifies that a lost
  fence cancels before network, append, alert, or finalize work.
