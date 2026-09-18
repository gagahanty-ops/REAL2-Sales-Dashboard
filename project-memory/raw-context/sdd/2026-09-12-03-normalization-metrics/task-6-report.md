# Task 6 report: immutable metric snapshots and versioned plans

Commit: `cd46fa0` (`feat: approve immutable metric snapshots`).

## Preflight ruling

The plan names the migration `0006_metric_snapshots.sql`, but migrations
`0005`–`0010` are reviewed and immutable, so the file is
`0011_metric_snapshots.sql`. This follows the ledger's standing ruling that plan
file names are illustrative while migration order is not.

## Delivered

- `supabase/migrations/0011_metric_snapshots.sql` — `sales_plans`,
  `metric_snapshots`, `metric_cells`, `metric_lead_facts`,
  `stage_snapshot_rows` and the singleton `current_snapshot`, with RLS, grants
  and four triggers: snapshot content is immutable, the snapshot header may only
  move `candidate → approved | rejected` and `approved → published`, snapshots
  are never deleted, and a closed plan row can never be rewritten.
- `packages/db/src/snapshots.ts` — `createMetricSnapshot` (one transaction),
  `validateSnapshot` (read-only), `approveSnapshot` (locks the candidate,
  validates, marks approved and moves the pointer in one transaction),
  `rejectSnapshot`, `getCurrentSnapshot`, `getSnapshotByVersion`,
  `listSnapshotCells`.
- `packages/db/src/sales-plans.ts` — `setSalesPlanTarget` (closes the previous
  row, inserts the next version), `listSalesPlans`, `getCurrentSalesPlan`.
- `apps/worker/src/jobs/build-snapshot.ts` — builds cells (`all/all`,
  per manager, per channel and per pair), lead facts with a phone-safe display
  name, and stage rows with open counts, amounts and median/average age; the
  checksum is a canonical, order-independent SHA-256 of the content.
- `apps/web/src/app/api/plans/route.ts`,
  `apps/web/src/app/api/snapshots/[version]/route.ts`,
  `apps/web/src/app/settings/plans/page.tsx`,
  `apps/web/src/app/snapshots/[version]/page.tsx` and two navigation entries.
- `displayNameFor` is now exported from `@real2/domain` so the snapshot reuses
  the approved masking rule instead of duplicating it.

## TDD evidence

1. Red: `pnpm vitest run --project integration
   apps/worker/src/jobs/build-snapshot.integration.test.ts` → module not found,
   no tests collected.
2. Green: 14 integration checks for snapshots and plans; 6 for the plan and
   snapshot HTTP routes; 4 new security checks.
3. Mutations (each injected, suite run, file restored): blocked candidate
   approved (2 failures), pointer moved before validation (2), changed data
   silently rebuilt (1), checksum ignoring content (1), phone name stored raw
   (1), plan history overwritten (1), mid-month plan accepted (1), cross-foot
   check dropped (1 after the test was isolated), missing breakdown tolerated
   (1 after the test was added). Migration mutations: manager allowed to see
   every fact (1), worker granted update and delete on snapshot tables (1).
4. Two mutations initially survived because no test isolated them: a cross-foot
   mismatch was masked by a fact mismatch in the same fixture, and no fixture
   had a total without a breakdown. Both cases now have their own checks, and
   the mutations fail as they should.

## Controller gate (live local Supabase, rebuilt from migrations)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:secrets` | passed |
| `pnpm test` | repo/worker 16/16; unit 409/409 |
| `pnpm test:contracts` | 10/10 |
| `pnpm test:integration` | 127/127 |
| `pnpm test:security` | 28/28 |
| `supabase db lint --fail-on error`, `git diff --check` | passed |

## Handoff notes for Task 7

- `buildMetricSnapshot` is idempotent for unchanged input and refuses to rebuild
  a run whose normalized data changed, so an end-to-end test can assert the same
  checksum twice without special cases.
- Nothing schedules snapshot building or approval yet; wiring normalization and
  snapshots into the worker schedule stays a separate, reviewable change.
- Publication (`published` status, Sheets) belongs to Plan 5; the transition is
  allowed by the trigger but no code uses it yet.
- The plans page is read-only: the editing form is a UI task, the API behind it
  is complete and tested.
