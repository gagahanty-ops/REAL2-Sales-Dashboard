# Approved specification coverage

## Global contracts

| Spec requirement | Implementation location | Verification |
|---|---|---|
| exact stack and repository boundaries | Master roadmap; Plan 1 Task 1 | workspace test, lockfile, typecheck, build |
| roles and RLS | Plan 1 Tasks 3–4 | DB integration and negative RLS tests |
| API envelope/error codes/trace ID | Plan 1 Task 5 | route and log-redaction tests |
| UTC/Moscow dates and decimal money | Plan 3 Tasks 2 and 5 | boundary, property, and golden contract tests |
| idempotency and immutable current snapshot | Plan 2 Tasks 5–6; Plan 3 Tasks 3, 6–7 | repeated-run and pointer rollback tests |
| four UI states and stale preservation | Plan 4 Tasks 4–6 | component and E2E tests |
| performance/SLO | Plan 4 Task 6; Plan 5 Task 5 | seeded timing gate and freshness alerts |

## Module coverage

| Module | Plan tasks | Primary evidence |
|---|---|---|
| M1 — access and roles | Plan 1 Tasks 2–4 | disabled defaults, RLS, private auth, role tests |
| M2 — external amoCRM OAuth | Plan 2 Tasks 1–3 | one-use state, encryption, account binding, token redaction |
| M3 — pipeline/channel configuration | Plan 2 Task 4 | live discovery, checksum activation, exact-match validation |
| M4 — raw sync | Plan 2 Tasks 5–7 | append-only journal, complete pagination, retries, static safety |
| M5 — normalization/history | Plan 3 Tasks 1–4 | composite identity, timelines, milestones, quality lifecycle |
| M6 — metrics/plans/snapshots | Plan 3 Tasks 5–7 | ten golden scenarios, decimal totals, atomic current pointer |
| M7 — dashboard API/drill-down | Plan 4 Tasks 1–3 | one-snapshot queries, role scope, cursor and CSV contracts |
| M8 — dashboard UI | Plan 4 Tasks 4–6 | URL filters, four states, role/accessibility E2E |
| M9 — Google Sheet copy | Plan 5 Tasks 1–4 | protected-ID zero-request test, fingerprint, batch/checksum |
| M10 — operations | Plan 5 Tasks 5–7 | health/alerts, restore, kill switches, shadow acceptance |

## Cross-system scenarios

| Scenario | Verification task |
|---|---|
| S1 new open lead | Plan 3 Tasks 5 and 7 |
| S2 later application updates creation cohort | Plan 3 Tasks 5 and 7 |
| S3 payment in a later month updates creation cohort | Plan 3 Tasks 5 and 7 |
| S4 repeated sync | Plan 2 Task 5; Plan 3 Task 7 |
| S5 amoCRM unavailable | Plan 2 Task 6; Plan 5 Task 5 |
| S6 Google copy layout changed | Plan 5 Tasks 3–4 |
| S7 attempted amoCRM write | Plan 2 Tasks 1 and 7 |
| S8 attempted original-Sheet write | Plan 5 Tasks 2 and 4 |

## Explicit exclusions preserved

No plan introduces amoCRM mutation, private integration, webhooks, telephony control, messaging automation, AI scoring, automated source guessing, public signup, or direct writing to the original Sheet. Any such proposal requires a new feature specification and owner approval.

## Review result

Every global contract, module M1–M10, and scenario S1–S8 has at least one implementation task and named verification. Interface names shared across plans are fixed in each plan's `Interfaces` section. No production-enablement action is included in an agent-executed step.
