# Task 7 report: end-to-end metric consistency

Commit: `8833069` (`test: prove raw-to-snapshot metric consistency`).

## Delivered

- `packages/testkit/src/golden/real2-golden-raw.ts` — the golden dataset as raw
  amoCRM payloads: statuses, users, eleven leads and their stage events,
  including the re-entered application stage, the returned win, the unmapped
  source value, the win without a price, the repeated event delivery and the
  Moscow-midnight pair.
- `packages/db/src/snapshots.ts` — `exportComparableRows`, the stored evidence
  in a shape that can be compared with the golden expectations.
- `tests/contracts/raw-to-snapshot.contract.test.ts` — ingestion →
  `normalizeSyncRun` → `buildMetricSnapshot` → blocked approval → admin
  acceptance → approval, then equality with the golden daily, manager and
  channel rows; plus a check that drill-down facts carry no phone-like digits
  and that source freshness is carried, not recomputed.
- `tests/contracts/snapshot-idempotency.contract.test.ts` — the same checksum,
  the same rows and no extra records on a second execution; stage age measured
  against source freshness; raw-level deduplication of a repeated event.
- `tests/contracts/metric-catalog-coverage.test.ts` and
  `packages/testkit/src/golden/metric-contract-evidence.ts` — twenty-five
  contract keys, each naming an existing test file and what it proves; the test
  fails if an entry points at a file that no longer exists.
- `docs/runbooks/metric-reconciliation.md` — the manual procedure from a number
  in the report down to one amoCRM lead, with the five usual explanations of a
  discrepancy and an explicit list of what must never be done.

## Two defects the contracts found

1. **The snapshot read the wall clock.** Stage ages were measured against `new
   Date()`, so rebuilding the same run produced a different checksum a second
   later. The idempotency contract failed, and the builder now measures age
   against the run's source freshness, which makes a snapshot a pure function of
   its input.
2. **The golden dataset contained a price amoCRM cannot send.** A kopeck-precise
   price (`1000.55`) is unreachable through the real pipeline, because amoCRM's
   `price` is an integer and Task 2 maps it to `<integer>.00`. The golden lead
   now carries `1001.00`, and kopeck exactness stays covered where it can
   actually arise: the unit test for summation and the month average order value
   (`51001.00 / 3 = 17000.33`, rounded half up).

## TDD evidence

1. Red: the raw-to-snapshot contract failed on the missing fixture adapters,
   then on the first semantic mismatch (revenue `1000.00` against the expected
   `1000.55`), printing lead identifiers only, never personal data.
2. Green: contracts 19/19.
3. Mutations: daily export mixing breakdowns (1 failure), unmapped source value
   mapped to a channel (2), stage age back on the wall clock (1 after the exact
   age assertion was added), repeated events dropped from the fixture (1 after
   the deduplication assertion was added). Two of these initially survived
   because no test pinned the invariant; both now have explicit checks.

## Plan 3 completion gate (live local Supabase)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:secrets` | passed |
| `pnpm test` | repo/worker 16/16; unit 409/409 |
| `pnpm test:contracts` (run twice, before and after integration) | 19/19 both times |
| `pnpm test:integration` | 127/127 |
| `pnpm test:security` | 28/28 |
| `supabase db lint --fail-on error`, `git diff --check` | passed |

All ten golden scenarios pass exactly, repeated execution is idempotent, and a
blocked candidate cannot become the current snapshot.

## What Plan 3 does not include

- Nothing schedules normalization or snapshot building yet: both jobs exist and
  are tested, but no caller runs them. Wiring them into the worker schedule is a
  separate, reviewable change.
- The quality and plans pages are read-only; their write APIs are complete and
  tested, the forms are a UI task.
- Publication to Google Sheets and the `published` snapshot status belong to
  Plan 5.
