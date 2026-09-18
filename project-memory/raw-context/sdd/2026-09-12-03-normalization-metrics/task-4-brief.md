# Task 4 brief: reconcile and administer data-quality issues

Plan §Task 4. Authority: `SPEC.md` M5.3 (API and acceptance rules), M5.4,
`METRICS_CATALOG.md` §11 (mandatory counters) and §12 (publication).
Start commit: `46fc2dc`, full gate green.

## Scope

- `packages/domain/src/quality/codes.ts` — one policy table covering every code
  Tasks 2 and 3 can raise plus the catalogue's operational codes.
- `packages/domain/src/quality/gates.ts` (+ tests) — `evaluateQualityGate`.
- `packages/db/src/quality.ts` — cursor listing, admin acceptance and the
  lifecycle that resolves issues that stopped appearing.
- `apps/web/src/app/api/quality/issues/route.ts` and
  `.../issues/[id]/accept/route.ts`, `apps/web/src/app/quality/page.tsx`,
  plus `quality.integration.test.ts`.

## Preflight rulings

- **RQ1 — `missing_stage_history` cannot be accepted.** The plan's pseudocode
  marks it `acceptable: true`, but `SPEC.md` M5.3 states plainly that
  `missing_stage_history` and `E_SHEET_PROTECTED` may not be accepted. The spec
  is the authority, so the policy sets `acceptable: false`.
- **RQ2 — one policy table.** `codes.ts` unions Task 2's `LEAD_ISSUE_SEVERITY`,
  Task 3's `HISTORY_ISSUE_SEVERITY` and the operational codes of
  `METRICS_CATALOG.md` §11. A test proves the severities agree with both
  source catalogues, so a new code cannot silently miss its policy.
- **RQ3 — acceptance.** Admin only, reason of 10–500 visible characters, stored
  in `safe_details` together with `acceptedBy` and `acceptedAt`; status becomes
  `accepted` and `resolved_at` is set. Acceptance never edits amoCRM or raw
  data.
- **RQ4 — acceptance and publication.** Accepting only lifts the block for a
  code marked `acceptable`. An unacceptable blocking code stays blocking even
  when an issue row is accepted.
- **RQ5 — gate input.** The gate reads the catalogue's `<code>_count` counters.
  An unknown counter key or a negative count is a validation error, never a
  silent pass.
- **RQ6 — lifecycle.** The worker upserts still-present issues and resolves the
  ones that stopped appearing; nothing is deleted, and an accepted issue is not
  reopened by the same observation.
