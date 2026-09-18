# Task 4 report: data-quality reconciliation and gates

Commit: `feat: enforce explicit data-quality gates` on `feat/foundation-access`,
started from `46fc2dc`.

## Delivered

- `packages/domain/src/quality/codes.ts` — `QUALITY_CODE_POLICY` for all
  eighteen codes (Task 2 snapshot codes, Task 3 timeline codes and the
  operational codes of `METRICS_CATALOG.md` §11), with a compile-time proof that
  both source catalogues are covered, plus `isQualityCode`,
  `isAcceptableQualityCode`, `qualityCodeBlocks` and `qualityCounterKey`.
- `packages/domain/src/quality/gates.ts` — `evaluateQualityGate(summary,
  { acceptedCodes })` and `emptyQualitySummary()`. Blocking output follows the
  sorted catalogue, unknown or negative counters are validation errors, and an
  acceptance lifts a block only for an acceptable code.
- `packages/db/src/quality.ts` — keyset `listQualityIssues`, `acceptQualityIssue`
  (reason 10–500 characters, evidence in `safe_details`, `accepted` status and
  `resolved_at`), `summarizeOpenQualityIssues` and the repository's
  `resolveAbsent` lifecycle.
- `apps/web/src/app/api/quality/issues/route.ts` (admin/head list with the gate),
  `.../issues/[id]/accept/route.ts` (admin only, same-origin), and
  `apps/web/src/app/quality/page.tsx` with a navigation entry.
- `normalizeSyncRun` now resolves the issues of observed leads that stopped
  appearing and reports `issuesResolved`.

## TDD evidence

1. Red: `pnpm vitest run packages/domain/src/quality/gates.test.ts` → module not
   found, no tests collected.
2. Green: 18/18 domain checks; 10/10 API integration checks; 11/11 worker
   integration checks after the lifecycle test was added.
3. Domain mutations: acceptance lifting every block (1 failure), unknown counter
   tolerated (1), forbidden code made acceptable (2), negative count tolerated
   (1), catalogue left unsorted (2). All detected.
4. API and repository mutations: forbidden code accepted (1), head allowed to
   accept (1), manager allowed to list (1), cross-origin acceptance (1), unknown
   filter code tolerated (1), cursor ignored (1), short reason allowed (1),
   second acceptance allowed (1). All detected.
5. Two mutations initially survived — a redundant status pre-check before the
   guarded update, and the repository's reason validation that the route schema
   already enforced. The redundant check was removed and a direct repository
   test was added, after which both mutations fail as they should.

## Rulings

RQ1–RQ6 are recorded in `task-4-brief.md`. The one that changes the plan:
`missing_stage_history` is **not** acceptable, because SPEC M5.3 forbids
accepting it while the plan's pseudocode marked it acceptable. The spec is the
authority.

## Controller gate (live local Supabase)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | passed |
| `pnpm test` | repo/worker 16/16; unit 384/384 |
| `pnpm test:integration` | 107/107 |
| `pnpm test:security` | 24/24 |
| `pnpm test:contracts`, `pnpm check:secrets`, `git diff --check` | passed |
| `supabase db lint --fail-on error` | no schema errors |

## Handoff notes for Task 5

- Metrics read the gate through `evaluateQualityGate(summary, { acceptedCodes })`;
  the accepted codes come from `data_quality_issues` rows with status `accepted`.
- `summarizeOpenQualityIssues` counts only open issues, so an accepted or
  resolved issue no longer feeds a counter.
- The quality page is a read-only list today: the acceptance form is a UI task,
  the API behind it is complete and tested.
- Nothing calls `normalizeSyncRun` yet; wiring normalization into the schedule
  stays a separate, reviewable change.
