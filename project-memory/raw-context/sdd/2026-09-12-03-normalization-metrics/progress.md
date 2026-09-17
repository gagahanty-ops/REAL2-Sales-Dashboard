# SDD ledger — plan: docs/superpowers/plans/2026-09-12-03-normalization-metrics.md

## Binding context

- Spec authority: `SPEC.md` M5–M7, scenarios S1–S5, and the complete `METRICS_CATALOG.md`.
- Branch/workspace: `feat/foundation-access` in `/Users/arlandorizzi/Desktop/REAL2-Sales-Dashboard`.
- Starting commit: `d9226b0d3a3bf8472cd10413986ce01afde8dc6f`.
- No live OAuth, amoCRM, Google API, or protected-sheet access is permitted during implementation.
- Both external switches stay disabled.

## Preflight rulings

- Ruling: Task 1 uses `0010_normalized_leads.sql`, not the stale illustrative `0005` name, because reviewed immutable migrations `0005`–`0009` already exist. Reusing `0005` would corrupt ordered migration history.
- Ruling: PostgreSQL 17 is authoritative because `SPEC.md` and the implemented foundation pin PostgreSQL 17; the Plan 3 header's PostgreSQL 16 reference was corrected before schema work.
- Ruling: Plan pseudocode is illustrative. Final keys, grants, RLS, and repository interfaces must match the existing identity/config/sync schema rather than create parallel identities.

## Task progress

- Task 1: complete and independently reviewed.
  - Initial implementation: `0f45cd7940f6abffccd656adaf31a36c42595866` (`feat: add normalized lead history schema`).
  - Review found five P2 issues: event-history UPDATE privilege, transaction-incompatible factories, non-decimal-safe money input, nullable quality-key counting, and unsafe bigint conversion.
  - Fix round 1: `0ae530f65a02059a4535f628fd19daf1fe15c70f` (`fix: harden normalized lead repositories`).
  - Scoped re-review approved all five fixes with no remaining blocker.
  - Controller gate on 2026-09-17: database reset passed; integration 86/86; security 24/24; repo/worker 16/16; unit 110/110; lint, typecheck, production build, tracked-secret scan, and diff check passed.
- Task 2: not started. Resume with deterministic normalization using strict TDD; generate `task-2-brief.md` from the executable plan before implementation.

## Dependency scan

| Producer | Consumer | Contract to preserve |
|---|---|---|
| Task 1 | Task 2 | normalized lead schema and exact decimal-string money boundary |
| Task 1 | Task 3 | stage/responsible histories, milestones, shared transaction connection |
| Task 1 | Task 4 | quality issue identity, nullable lead scope, lifecycle status |
| Task 1 | Task 6 | normalized rows and immutable snapshot source contracts |
| Task 2 | Task 3 | deterministic normalized inputs and timestamp semantics |
| Task 3 | Task 4 | missing/ambiguous milestone evidence becomes explicit quality issues |
| Task 4 | Task 6 | blocking gates must prevent approval when open issues exist |
| Task 5 | Task 6 | canonical metric engine feeds snapshot facts and aggregates |
| Tasks 1-6 | Task 7 | golden raw-to-snapshot end-to-end consistency contract |

## Stop checkpoint — 2026-09-17

- Development was stopped immediately at the user's request after Task 1 reached a safe reviewed boundary.
- Source worktree was clean before this ledger/plan checkpoint; no Task 2 production code exists.
- No live OAuth installation, amoCRM business call, Google API call, or source-sheet write occurred.
- `SYNC_ENABLED=false` and `SHEET_PUBLISH_ENABLED=false` remain binding requirements for the next agent.
