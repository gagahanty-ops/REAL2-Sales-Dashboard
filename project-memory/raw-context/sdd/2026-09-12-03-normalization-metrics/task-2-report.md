# Task 2 report: deterministic lead normalization

## Delivered

- `packages/domain/src/time/moscow-date.ts` — `toMoscowDate`, strict `parseIsoInstant` (explicit `Z`/`±HH:MM`, real calendar dates, four-digit years) and `unixSecondsToInstant` (positive safe integer seconds up to `9999-12-31T20:59:59Z`, otherwise `null`).
- `packages/domain/src/money/rubles.ts` — branded canonical `Rubles` string, `parseAmoRubles` (amoCRM integer `price` → `"<int>.00"`, typed `missing` / `invalid` with reason `wrong_type | not_finite | not_an_integer | negative | out_of_range`), exact `parseRubleDecimal`, `isRubles`, `isZeroRubles`. No float arithmetic; bounds match `numeric(14,2)` and the Task 1 repository check.
- `packages/domain/src/leads/channel.ts` — `matchChannel` (exact, case/whitespace-sensitive, active rules only, catalog §7 priority per ruling R1, conflict → `unknown`, deterministic winner by priority then id) and `extractChannelInput` (configured custom field, `_embedded.tags[].name`, `_embedded.source.name`; malformed shapes → no values; deal name never read).
- `packages/domain/src/leads/normalize-lead.ts` — total, pure `normalizeLead(raw, context)` returning `normalized | excluded | rejected` plus code-sorted quality issue candidates (`LEAD_ISSUE_SEVERITY`), phone-safe `displayName`, stable `Сделка #<id>` fallback, confirmed amo URL, Moscow `createdDate`, canonical `normalizedAt`. Invalid context throws `AppError(E_VALIDATION)`.
- `packages/testkit/src/lead-builders.ts` — synthetic raw-lead, channel-rule and context builders (fictional values only, phone fixtures use the non-assigned `000` code).
- Exports from `@real2/domain` and `@real2/testkit`; `fast-check@4.10.1` dev dependency (plan tech stack).

## TDD evidence

1. Red (2026-09-17): `pnpm vitest run packages/domain/src/leads/normalize-lead.test.ts packages/domain/src/leads/channel.test.ts packages/domain/src/time packages/domain/src/money` → `Test Files 4 failed (4)`, each `Cannot find module './channel.js' | '../time/moscow-date.js' | './rubles.js' | './moscow-date.js'`.
2. Green per module: moscow-date 40/40, rubles 45/45 (after fixing a test title that could not serialize a BigInt), channel 27/27 (after adding the testkit/domain exports), normalize-lead 84/84. Domain total 215/215.
3. Mutation check (each defect injected, suite run, file restored): unmapped-source fall-through (3 failures), unsorted rule matches (1), inactive rules honoured (2), phone threshold 7 digits (1), unsorted issues (2), zero won price accepted (1), calendar validation removed (1), UTC instead of Moscow (10). Every mutation was detected; the restored suite returned to 215/215.
4. Refactor (explicit result objects instead of a cast helper) kept 215/215; domain/testkit lint and typecheck clean.

## Rulings applied during implementation

- R5 tightened before implementation: phone-like requires ≥10 digits (a 7-digit threshold hid ordinary names such as "Кухня 2400x600").
- R8 tightened: timestamps above `253402289999` are rejected so the Moscow date never leaves the `YYYY-MM-DD` shape.

## Review fix rounds

- Round 1 (`0072eff`): phone runs of ≥10 digits inside a displayed name are masked as `*** ***-**-NN` (SECURITY_READ_ONLY §7); NUL byte removed from `channel.test.ts`; a present non-text source value decides as `unmapped_source_field` (`NON_TEXT_SOURCE_VALUE`); a valid lead of another pipeline is `excluded` before timestamp/status checks; invisible-only names use the fallback; ISO offsets must be real (quarter hours, ≤14:00) and instants ≥ epoch; `parseRubleDecimal` rejects non-strings at runtime; plan note records rulings R1/R2. Red: 13 new failing checks; green 234/234; three injected mutations detected.
- Round 2 (`4c46499`): phone separators widened to every dash, minus sign, invisible format characters and `/ _ , :`; context rejects empty or NUL rule values. Red: 9 failing checks; green 242/242 in three consecutive runs.
- Final scoped re-review: spec/task APPROVED, code quality/security APPROVED, no open findings. Accepted: display over-masking of long non-phone digit runs (N2).

## Initial verification on this host (Node v22.23.2, pnpm 10.34.5)

- `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm test:contracts` (no contract files yet), `pnpm check:secrets`, `git diff --check`: passed.
- `pnpm test`: repo/worker 16/16; unit 290/306 — all 196 new tests pass; the 16 failures are the pre-existing DB-backed `packages/integrations/src/amo/oauth.test.ts` cases (`ECONNREFUSED 127.0.0.1:54322`), identical to the untouched baseline on this host.
- `supabase db reset`, `pnpm test:integration`, `pnpm test:security`: not runnable here — no Docker/Supabase CLI; Homebrew refuses installs because the Command Line Tools are outdated, the disk has ~2 GB free and swap is exhausted. Task 2 changes no SQL, repository, integration or worker code.

## Environment note

`typecheck` in a fresh clone needs `pnpm build` first because `@real2/integrations` publishes types from `dist/`.

## Final controller gate (HEAD `4c46499`, 2026-09-17)

| Check | Result |
|---|---|
| `supabase db reset` | not runnable — no Supabase CLI / Docker on this host |
| `pnpm test:integration` | 12 passed (`transport.integration.test.ts`); 8 DB-backed files fail with `ECONNREFUSED 127.0.0.1:54322` |
| `pnpm test:security` | 5 passed (read-only import/method gates, log redaction); `rls.security.test.ts` fails on the missing DB |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm test` | repo/worker 16/16; unit 317 passed, 16 DB-backed `oauth.test.ts` failures (same as untouched baseline) |
| `pnpm build` | passed |
| `pnpm test:contracts` | passed (no contract files yet) |
| `pnpm check:secrets` | passed |
| `git diff --check` | passed |

## Completed controller gate (HEAD `1e4f22a`, 2026-09-19)

The host now runs colima 0.10.3 (`--vm-type vz --cpu 2 --memory 3 --disk 12`) and Supabase CLI 2.117.0, so the database part of the gate ran in full.

| Check | Result |
|---|---|
| `supabase start` | all ten migrations plus the seed applied |
| `supabase db lint --fail-on error` | no schema errors |
| `pnpm test:integration` | 86/86 in 9 files |
| `pnpm test:security` | 24/24 in 4 files |
| `pnpm test` | 333/333 in 25 files |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, `pnpm check:secrets`, `git diff --check` | passed |

The sixteen `oauth.test.ts` failures were missing-database failures only: they turned green with no code change. Task 2 is closed by a complete gate, and Task 3 may start.
