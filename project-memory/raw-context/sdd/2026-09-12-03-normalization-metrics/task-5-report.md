# Task 5 report: canonical metrics and the golden dataset

Commit: `feat: calculate canonical REAL2 metrics` on `feat/foundation-access`.

## Delivered

- `packages/domain/src/metrics/types.ts` — `MetricLeadFact`, `MetricAggregate`
  and the daily, manager and channel row shapes.
- `packages/domain/src/metrics/aggregate.ts` — `aggregateMetrics`,
  `aggregateDaily`, `aggregateByManager`, `aggregateByChannel`, `conversion`,
  `moneyAverage`, `planCompletion` and `deltaPct`. Money is exact: prices are
  parsed into BigInt kopecks and formatted back, so no floating point ever
  touches a total. Percentages come from unrounded integers and are rounded to
  one decimal; a zero denominator yields `null`, never zero.
- `packages/domain/src/metrics/periods.ts` — `previousPeriod` (a whole calendar
  month compares with the previous calendar month and keeps its own length; any
  other range compares with the range immediately before it), plus
  `dateRangeLength`, `eachDate`, `isDateInRange` and `formatDate`.
- `packages/testkit/src/golden/real2-golden.ts` and `.expected.ts` — the ten
  scenarios of `METRICS_CATALOG.md` §13 with their expected month, daily,
  manager and channel rows. The Moscow-midnight pair derives its calendar day
  through `toMoscowDate`, so the boundary is proven rather than hard-coded.
- `tests/contracts/metrics.contract.test.ts` — ten contract checks over the
  golden data.

## TDD evidence

1. Red: `pnpm vitest run packages/domain/src/metrics` → both new suites failed to
   load, no tests collected.
2. Green: 25 aggregate and period checks, then 10 contract checks; 35 together.
3. Mutations (each injected, suites run, file restored): payment without the
   current won status (8 failures), revenue over every lead (7), duplicates
   counted twice (8), percentages rounded to whole numbers (5), averages always
   rounded up (3), month compared with a fixed-length range (3), unassigned
   manager group placed first (1). All detected; restored to 35/35.
4. One expectation was tightened while implementing: a malformed price is
   rejected for every selected lead, not only for payments, because a bad price
   is a defect rather than a rounding question.

## Controller gate

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:secrets` | passed |
| `pnpm test` | repo/worker 16/16; unit 409/409 |
| `pnpm test:contracts` | 10/10 |
| `pnpm test:integration` | 107/107 |
| `pnpm test:security` | 24/24 |
| `git diff --check` | passed |

## Handoff notes for Task 6

- `aggregateMetrics` is pure and takes facts, so the snapshot builder decides
  how facts are read from `leads` and `lead_milestones`; nothing in the engine
  touches the database.
- `MetricAggregate.revenueRub` and `averageOrderValueRub` are canonical decimal
  strings, ready to store in `numeric(14,2)` without conversion.
- Percentages are display-rounded to one decimal. A snapshot that needs exact
  ratios must store the integer counts, which it already does.
- `previousPeriod` is the comparison rule for period deltas; `deltaPct` returns
  `null` on an empty base, which the UI must render as "—".
