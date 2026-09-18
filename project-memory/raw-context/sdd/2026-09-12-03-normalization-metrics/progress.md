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
- Task 2: complete, independently approved after two fix rounds, full controller gate passed on 2026-09-19.
  - Actual start: clean `feat/foundation-access` at `2f50f23bbc67056c58c79a6eeb8a150ac23988d1` (`docs: embed complete project memory in source repository`); local HEAD, tracking ref and GitHub remote agreed.
  - Workspace moved to a new host: `/Users/ishop/Desktop/REAL2-Sales-Dashboard.nosync` (`~/Desktop/REAL2-Sales-Dashboard` is a symlink to it). The Desktop is synced by iCloud and, with the disk nearly full, macOS evicted repository, `.git` and `node_modules` files (`dataless`), which made lint/module loading fail at random. The `.nosync` suffix keeps the working copy local; the evicted clone had no unique work and was replaced.
  - Node `v22.23.2` from the official tarball at `~/.local/node22/bin` (Homebrew could not install `node@22` on this host); pnpm `10.34.5`.
  - No local `.env`; `.env.example` keeps `SYNC_ENABLED=false` and `SHEET_PUBLISH_ENABLED=false`.
  - Brief: `task-2-brief.md` with preflight rulings R1–R9, plus R10/R11 from review fix rounds.
  - Implementation: `23e48535347b5b1bc5ac654a63a7a47f098dc0ad` (`feat: normalize REAL2 lead snapshots deterministically`). Red evidence: four new test files failed on missing modules; green 215/215; eight injected mutations were all detected.
  - Independent review: spec/task APPROVED; code quality/security CHANGES REQUIRED with two P2 (phone text visible inside longer display names; NUL byte made `channel.test.ts` binary to git) and seven P3 notes.
  - Fix round 1: `0072eff` (`fix: harden deterministic lead normalization`) — both P2 and the actionable P3 notes. Scoped re-review: both verdicts APPROVED; new non-blocking P3 notes N1 (more phone separators), N2 (display over-masking, accepted), N3 (non-text sentinel vs context rule).
  - Fix round 2: `4c46499` (`fix: mask phones with any common separator in lead names`) — N1 and N3. Scoped re-review: both verdicts APPROVED, no remaining findings.
  - Plan Task 2 Steps 1–5 marked complete after a fresh `pnpm vitest run packages/domain/src/leads` (127/127) and `pnpm test:contracts` (no contract files yet, exit 0).
  - Controller gate on 2026-09-17, Node v22.23.2, HEAD `4c46499`: lint, build, typecheck, contracts, tracked-secret scan and `git diff --check` passed. `pnpm test`: repo/worker 16/16, unit 317/333 (all domain/testkit/web/worker files green; the 16 failures are the DB-backed `packages/integrations/src/amo/oauth.test.ts`). `pnpm test:integration`: 12/86 run green (`transport.integration.test.ts`), the eight DB-backed files fail with `ECONNREFUSED 127.0.0.1:54322`. `pnpm test:security`: 5/24 green (static read-only import/method gates and log redaction), `rls.security.test.ts` fails on the same missing database.
  - Gate on 2026-09-17 was incomplete: `supabase db reset` and the DB-backed integration/security/unit suites cannot run on this host — no Docker runtime or Supabase CLI; Homebrew refuses installs until the owner updates the Xcode Command Line Tools (needs sudo); only ~2 GB disk is free and swap is exhausted. Task 2 touched no SQL, repository, integration, worker or web code, and the full gate was re-run successfully on 2026-09-19 (see below) before Task 3 started.

- Task 3: complete, full gate passed on 2026-09-19 at `05958bb`.
  - Brief `task-3-brief.md` (rulings R1–R14, R10 reversed and R13a added during implementation); report `task-3-report.md`.
  - Domain `buildLeadHistory` + `extractHistoryEvent`: 33 new tests, seven injected mutations all detected.
  - `packages/db/src/normalize-run.ts` and `apps/worker/src/jobs/normalize-sync-run.ts`: 10 integration tests on the live database, seven injected mutations all detected.
  - Derived history stays append-only and nothing is deleted from the normalized layer; a stored lead that left the pipeline gets a blocking `out_of_scope_pipeline` issue instead.
  - Gate: lint, typecheck, build, contracts, secret scan, `supabase db lint` clean; `pnpm test` 366/366 plus repo/worker 16/16; integration 96/96; security 24/24.
  - Not wired into the schedule yet: no caller invokes `normalizeSyncRun`.

- Task 4: complete, full gate passed on 2026-09-19.
  - Brief `task-4-brief.md` (RQ1–RQ6), report `task-4-report.md`.
  - `QUALITY_CODE_POLICY` unions all snapshot, timeline and operational codes; `evaluateQualityGate` blocks only policy-blocking codes and honours acceptance only for acceptable ones.
  - SPEC M5.3 overrides the plan's pseudocode: `missing_stage_history` cannot be accepted.
  - Quality API (list with gate, admin acceptance with evidence) and `/quality` page; `normalizeSyncRun` resolves issues that stopped appearing.
  - Gate: unit 384/384 plus repo/worker 16/16; integration 107/107; security 24/24; lint, typecheck, build, contracts, secret scan, `supabase db lint` clean.

- Task 5: complete, full gate passed on 2026-09-19.
  - Report `task-5-report.md`. Metric engine is pure: cohort by creation day, one lead once, payment needs current won status plus a confirmed won event, money in exact BigInt kopecks, ratios `null` on a zero base.
  - Golden dataset covers all ten scenarios of METRICS_CATALOG section 13, including Moscow midnight and a repeated observation; ten contract checks assert month, daily, manager and channel rows.
  - Seven injected mutations all detected.
  - Gate: unit 409/409 plus repo/worker 16/16; contracts 10/10; integration 107/107; security 24/24; lint, typecheck, build and secret scan clean.

## Handoff notes for Task 3/4 (from Task 2 review)

- `NormalizedLead.createdAt`/`sourceUpdatedAt`/`normalizedAt` are ISO strings; `UpsertLeadInput` expects `Date` for `createdAt`/`sourceUpdatedAt` — convert in `normalizeSyncRun`. `priceRub` (`Rubles`) is assignable to the repository's decimal string.
- `excluded`/`rejected` results carry `lead: null`; Task 3 must decide what happens to an already-stored `leads` row whose lead moved to another pipeline or became malformed (it must not keep counting silently).
- Pass `sourceFieldId: null` in the normalization context when the active config's source field was not found (`sourceFieldFound=false`).
- `pipelineStatusIds` must come from the configured pipeline's metadata of the same successful sync run.
- Task 4 `qualityCodePolicy` must cover the Task 2 codes: `malformed_lead`, `account_mismatch`, `invalid_created_at`, `invalid_updated_at`, `out_of_scope_pipeline`, `unknown_current_status`, `channel_rule_conflict`, `invalid_price` (plus the existing `unknown_channel`, `missing_responsible`, `won_without_valid_price`).
- `NON_TEXT_SOURCE_VALUE` appears in extracted channel input; a future "encountered channel values" view must not store or display it verbatim.
- The current sync worker does not request `with=source`, so `integration_source_exact` rules have no input until an approved worker change adds it.
- Open owner question: METRICS_CATALOG §7 / SPEC M3.5 wording could state explicitly that a filled but unmapped source field yields `unknown` (ruling R1, confirmed by review) and that conflicts are evaluated within one source kind.

## Окружение для DB-gate (2026-09-17 → 2026-09-19)

Supabase CLI 2.117.0, docker CLI 29.8.1, colima 0.10.3 и lima 2.2.0 установлены вручную в `~/.local`. Первая попытка запуска провалилась: `colima start` на диске с 3 ГБ свободного места заполнил диск полностью (runbook требует 10 ГБ). После освобождения восстановимых кэшей (12 ГБ свободно) VM и Supabase поднялись штатно.

## DB-gate пройден (2026-09-19)

`colima start --vm-type vz --cpu 2 --memory 3 --disk 12`, затем `supabase start`: все 10 миграций и сид применились без ошибок. Результаты на локальной БД:

| Проверка | Результат |
| --- | --- |
| `pnpm test:integration` | 86/86, 9 файлов |
| `pnpm test:security` | 24/24, 4 файла |
| `pnpm test` | 333/333, 25 файлов |
| `supabase db lint --fail-on error` | без ошибок схемы |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, `pnpm check:secrets` | без замечаний |

Ранее падавшие 16 тестов требовали только живую базу; после её появления они зелёные без единой правки кода. Задача 2 закрыта полным гейтом.

## Блокер доступа к GitHub (2026-09-17)

Push с машины `ishop` отклонён: `Permission to sarrinoj-glitch/REAL2-Sales-Dashboard.git denied to gagahanty-ops` (HTTP 403). И HTTPS-токен, и SSH-ключ на этой машине принадлежат аккаунту `gagahanty-ops`, у которого права `pull: true, push: false`.

Коммиты Task 2 существуют только локально:

```text
23e4853 feat: normalize REAL2 lead snapshots deterministically
0072eff fix: harden deterministic lead normalization
4c46499 fix: mask phones with any common separator in lead names
4a7faa8 docs: checkpoint deterministic normalization task
плюс docs-коммит «record the blocked push and the recovery bundle» (последний на ветке)
```

Что нужно от владельца (любой вариант):

1. дать аккаунту `gagahanty-ops` право записи (Collaborator: Write);
2. либо забрать изменения бандлом `~/Desktop/REAL2-task2.bundle` с аккаунта владельца:

```bash
git fetch ~/Desktop/REAL2-task2.bundle feat/foundation-access:task2
git merge --ff-only task2      # в клоне на feat/foundation-access
git push origin feat/foundation-access
```

После push обязательно сверить local, tracking и `git ls-remote`.

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

## Task 2 checkpoint — 2026-09-17 (host `ishop`)

- Task 2 code is implemented, reviewed (two fix rounds, final APPROVED/APPROVED) and pushed; the DB-backed part of the controller gate is pending on a host with Docker + Supabase CLI.
- Next: re-run `supabase db reset` and the full gate on a capable host; only then start Task 3 (history and milestones).
- No live OAuth, amoCRM, Google API or source-sheet access occurred; `SYNC_ENABLED` and `SHEET_PUBLISH_ENABLED` stayed false (no local `.env` exists on this host).

## Stop checkpoint — 2026-09-17 (Task 1)

- Development was stopped immediately at the user's request after Task 1 reached a safe reviewed boundary.
- Source worktree was clean before this ledger/plan checkpoint; no Task 2 production code exists.
- No live OAuth installation, amoCRM business call, Google API call, or source-sheet write occurred.
- `SYNC_ENABLED=false` and `SHEET_PUBLISH_ENABLED=false` remain binding requirements for the next agent.
