# SDD ledger — plan: docs/superpowers/plans/2026-09-12-05-sheets-operations-rollout.md

## Binding context

- Spec authority: `SPEC.md` M9–M10 and scenarios S5–S8; `SECURITY_READ_ONLY.md`
  sections 5 and 9–12.
- Branch `feat/foundation-access`; start commit `89de91c` (Plan 4 complete).
- Both external switches stay `false` for the whole plan. No write to amoCRM and
  no write to any Google spreadsheet happened during implementation.

## Preflight rulings

- **RS1 — migration number.** The plan names
  `0007_sheet_publication_and_alerts.sql`, but migrations `0005`–`0011` are
  reviewed and immutable, so the file is `0012_sheet_publication_and_alerts.sql`.
- **RS2 — protection is enforced twice.** The protected spreadsheet identifier
  is a frozen code constant *and* a database check constraint, so neither a
  compromised configuration nor a direct insert can turn the original into a
  target.
- **RS3 — no Google SDK.** The client is plain `fetch` with a signed service
  account assertion built on `node:crypto`. It adds no dependency, keeps every
  request visible in one file and makes the request ledger testable against a
  local server.
- **RS4 — switches can only be turned off by code.** `disableSystemControl`
  exists; there is deliberately no counterpart that enables one. Enabling an
  external write stays a human action, which is why publication disables itself
  after a checksum failure but never re-enables itself.
- **RS5 — expected sheet names come from the mapping, not from the code.** The
  plan's example hard-codes month names such as "каналы сентябрь 2026"; a
  constant like that rots every month. Validation checks the sheets the
  administrator actually mapped.
- **RS6 — one logical field is one column.** A rectangular range would make the
  mapping ambiguous about which value lands where, so the payload builder
  refuses it.
- **RS7 — a shorter report clears the tail of its range.** Rows that disappeared
  are overwritten with empty cells: yesterday's numbers must not survive
  underneath today's shorter report.
- **RS8 — the shadow period is owner-run.** Tasks 1–6 and the tooling of task 7
  are implemented and tested; the 7–14 day reconciliation itself, the OAuth
  installation and both enable decisions belong to the owner and are documented,
  not executed.

## Task progress

- Task 1 (`e8ec16a`): publication and alert schema with its invariants; 13
  integration checks, 4 security checks, four injected mutations detected.
- Task 2 (`c8da77f`): protected-identifier gate before credentials or client,
  dual switch for writes, fetch-based client; 19 checks, six mutations detected.
- Task 3 (`e80fb50`): layout fingerprint, mapping validation, configuration API
  and settings page; 29 checks, six mutations detected.
- Task 4 (`00b1c18`): payload builder, publisher with preflight fingerprint,
  one batch and read-back verification, worker job and the schedule that was
  missing; 27 domain, 8 publisher and 8 worker checks.
- Task 5 (`e4ea8ce`): system health, readiness, alerts, redacted alert email and
  the operations page; 16 checks, five mutations detected.
- Task 6 (`e3350ac`): hardened production Compose, Caddy, configuration
  validator, restore rehearsal and four runbooks; 4 repository checks, and the
  rehearsal actually executed against the local database.
- Task 7 (`ecc8c34`): manual-report parser, exact comparator, reconciliation job
  and page, shadow acceptance and go-live runbooks; 11 checks.

## Also closed here

The gap flagged at the end of Plan 3 and Plan 4 is closed: the worker now runs
normalization, snapshot building and approval on every iteration, and publishes
only when publication is configured and both switches are on.

## Plan 5 completion gate (live local Supabase)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | passed |
| `pnpm test` | repo/worker 20/20; unit 557/557 |
| `pnpm test:contracts` | 24/24 |
| `pnpm test:integration` | 206/206 |
| `pnpm test:security` | 33/33 |
| `pnpm test:e2e` | 22/22 (run separately from the unit suite) |
| `supabase db lint --fail-on error` | no schema errors |
| `node scripts/check-deployment-config.mjs deploy/docker-compose.production.yml` | safe |
| `scripts/verify-backup-restore.sh` | rehearsal passed against the local database |
| `git diff --check` | passed |

No amoCRM request and no Google request happened during the whole plan: both
switches stayed `false`, and every Google interaction in the tests goes to a
local fake or an injected client.

## What remains for the owner

- install the amoCRM integration and enable synchronization;
- create the Sheet copy manually and share it with the service account;
- run the 7–14 day shadow reconciliation and record the evidence;
- make the two enable decisions described in `docs/runbooks/production-go-live.md`.
