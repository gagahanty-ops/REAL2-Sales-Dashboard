# Task 3 report: stage and responsibility timelines and milestones

Commit: `05958bb` (`feat: derive auditable lead timelines and milestones`) on
`feat/foundation-access`, started from `6dfd2a7`.

## Delivered

- `packages/domain/src/leads/build-history.ts` — pure `buildLeadHistory`:
  ordering by canonical instant then event ID, duplicate removal, first-
  observation milestones, responsible timeline (at creation, at application, at
  won, current), closed stage durations and the open stage age against the run
  snapshot, plus `HISTORY_ISSUE_SEVERITY` with `duplicate_event`,
  `invalid_event_time`, `malformed_event_payload`, `missing_stage_history` and
  `stage_history_conflict`. `extractHistoryEvent` turns a stored raw amoCRM
  event into a timeline event and separates "not a timeline event" from "a
  timeline event whose payload cannot be read".
- `packages/db/src/normalize-run.ts` — `createNormalizeRunRepository`: loads the
  run with its account, the run's raw leads, statuses and users, the lead events
  of the account, the already stored lead IDs, and applies one write plan inside
  a single transaction.
- `apps/worker/src/jobs/normalize-sync-run.ts` — `normalizeSyncRun` joins Task
  2's `normalizeLead` with `buildLeadHistory`, plans `amo_users`,
  `pipeline_statuses`, `leads`, stage and responsible rows, milestones and
  quality issues, and returns the run counters.
- Exports from `@real2/domain` and `@real2/db`. No migration and no schema
  change: the derived layer of Task 1 was sufficient.

## TDD evidence

1. Red (2026-09-19): `pnpm vitest run packages/domain/src/leads/build-history.test.ts`
   → `Failed to load url ./build-history.js`, no tests collected.
2. Green: 33/33 in the new domain suite; domain total 275/275.
3. Domain mutations (each injected, suite run, file restored): no event-ID
   tie-breaker (1 failure), handover at the same instant ignored (1), last
   milestone instead of first (2), won without event not reported (1), negative
   age allowed (1), malformed payload silently ignored (1), duplicates kept (1).
   All detected; restored suite back to 33/33.
4. Integration red→green on the live local database: 10/10 in
   `normalize-sync-run.integration.test.ts`.
5. Worker and repository mutations: stale derived responsible kept (1 failure),
   lead that left the pipeline kept (1), won status not marked (1), wrong
   application status (7), unfinished run accepted (1), deactivated user marked
   active (1), history issues dropped (1). All detected; restored to 10/10.

## Rulings and one reversal

The brief records R1–R14. One ruling was reversed during implementation and the
brief now carries both halves:

- R10 first said a stored lead that left the configured pipeline has its
  normalized and derived rows deleted. Implementing it required granting the
  worker `delete` and `update` on the derived tables, which collided with two
  standing rules: `METRICS_CATALOG.md` §11 ("Ни одна проблемная сделка не
  удаляется из сырого и нормализованного слоя") and Task 1's approved security
  test "does not let the worker rewrite append-only normalized history". The
  migration that granted those privileges was removed, the local database was
  rebuilt from migrations only, and the rule became: keep the row and the
  history, escalate `out_of_scope_pipeline` from `warning` to `blocking` with
  `stored: 1`. A lead that was never stored stays unwritten with the warning.
- R13a follows from the same invariant: stage and responsible rows are appended
  with `on conflict do nothing` and never rewritten, so a late handover does not
  change an already written stage row; the recalculated attribution lives in
  `lead_milestones`, which the worker may update. The integration test pins both
  halves of that behaviour.

## Controller gate (HEAD `05958bb`, live local Supabase)

| Check | Result |
|---|---|
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |
| `pnpm test` | repo/worker 16/16; unit 366/366 |
| `pnpm test:integration` | 96/96 |
| `pnpm test:security` | 24/24 |
| `pnpm test:contracts` | passed (no contract files yet) |
| `supabase db lint --fail-on error` | no schema errors |
| `pnpm check:secrets`, `git diff --check` | passed |

## Handoff notes for Task 4 and Task 5

- Task 4's `qualityCodePolicy` must union `LEAD_ISSUE_SEVERITY` (Task 2) and
  `HISTORY_ISSUE_SEVERITY` (Task 3). `missing_stage_history` may never be
  accepted (SPEC M5.3).
- The escalated `out_of_scope_pipeline` issue is the reconciliation hook for a
  stored lead that left the pipeline; Task 4 owns what happens to the row.
- `stageStays` is derived but never stored: no interval table exists, so Task 5
  computes speed metrics from `lead_stage_events` the same way.
- The worker still does not request `with=source`, so `integration_source_exact`
  rules stay without input until an approved worker change adds it.
- `normalizeSyncRun` uses the currently active config, not the config recorded
  on the run, which is what makes recalculation by a new rule version possible
  (SPEC M5.1 story 5). If Task 4 needs the historical config, it must pass it
  explicitly.
- Nothing calls `normalizeSyncRun` yet: wiring it into the sync schedule is a
  separate, reviewable change.
