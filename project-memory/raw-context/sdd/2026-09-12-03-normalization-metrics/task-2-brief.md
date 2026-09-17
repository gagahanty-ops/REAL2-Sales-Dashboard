### Task 2: Normalize lead snapshots, dates, money, names, and channels

Source: `docs/superpowers/plans/2026-09-12-03-normalization-metrics.md`, Task 2.
Spec authority: `SPEC.md` §0.6, M3.2/M3.5, M5.2/M5.5/M5.6; `METRICS_CATALOG.md` §2, §4.4, §7, §11.

**Files (exact, from the plan):**
- Create: `packages/domain/src/time/moscow-date.ts`
- Create: `packages/domain/src/money/rubles.ts`
- Create: `packages/domain/src/leads/normalize-lead.ts`
- Create: `packages/domain/src/leads/normalize-lead.test.ts`
- Create: `packages/domain/src/leads/channel.ts`
- Create: `packages/domain/src/leads/channel.test.ts`
- Create: `packages/testkit/src/lead-builders.ts`

Supporting edits required by these files (no new behaviour elsewhere):
- `packages/domain/src/index.ts` and `packages/testkit/src/index.ts` exports.
- Root `package.json` / `pnpm-lock.yaml`: add `fast-check` dev dependency (listed in the plan tech stack) for the property tests.
- Tests for `moscow-date.ts` and `rubles.ts` live next to them (`*.test.ts`) because rule 04 requires unit coverage of date and money logic.

**Interfaces:**
- Consumes: raw amoCRM lead payload (`unknown`), active pipeline config (`id`, `pipelineId`, `wonStatusId`, `sourceFieldId`), active `ChannelRule[]`, known status IDs of the configured pipeline, account ID, normalization time.
- Produces: `toMoscowDate(instant): YYYY-MM-DD`, `Rubles`, `parseAmoRubles`, `parseRubleDecimal`, `matchChannel(input, rules): ChannelMatch`, `extractChannelInput(raw, sourceFieldId)`, `normalizeLead(raw, context): NormalizedLeadResult`, ordered quality issue candidates.

## Required behaviour

1. `toMoscowDate` maps an instant to the `Europe/Moscow` calendar day: `2026-09-11T20:59:59Z → 2026-09-11`, `2026-09-11T21:00:00Z → 2026-09-12`. Invalid instants throw `AppError(E_VALIDATION)`; no silent fallback.
2. Money never passes through float arithmetic. `parseAmoRubles` accepts only a non-negative safe integer JSON number within `numeric(14,2)` (amoCRM `price` is `int`) and returns canonical `"<int>.00"`. Missing → typed `missing`; string / fractional / non-finite / negative / out-of-range → typed `invalid` with a reason. `parseRubleDecimal` parses decimal strings exactly and canonicalises to two digits.
3. Channel = exact, versioned, active rules only; case- and whitespace-sensitive; never deal name/free text; no substring match.
4. `normalizeLead` is a pure total function over arbitrary input: never throws for malformed raw data, identical input + context yields a deep-equal result, issues are ordered deterministically.
5. Missing/ambiguous/malformed/unknown values are explicit (typed status and quality issue candidates), never guessed.

## Preflight rulings (recorded before tests)

- R1 Channel priority follows `METRICS_CATALOG.md` §7 literally. If the confirmed source field exists on the lead and has at least one string value, that field decides: a matching rule gives the channel, otherwise `unknown` (`unknown_channel`, reason `unmapped_source_field`). Only when the field is absent/empty are confirmed tag rules consulted, then confirmed integration-source rules. Tags/integration sources without a matching rule do not stop the search, because the catalog only counts *confirmed* tag/source matches. The plan pseudocode (which falls through on an unmapped source field) is illustrative; the catalog is normative for attribution.
- R2 Within one source kind, matches that resolve to more than one channel give `unknown` with `channel_rule_conflict` (SPEC M3.5); the lead also carries `unknown_channel` so the §11 counter stays complete. Matches resolving to one channel pick the lowest-priority-number rule, independent of input order.
- R3 Raw shapes (amoCRM API v4 lead): tags = `_embedded.tags[].name`; integration source = `_embedded.source.name` (returned only with `with=source`; the current sync worker does not request it, so this kind is empty until a later approved change); source field = `custom_fields_values[field_id = sourceFieldId].values[].value` string items.
- R4 Lead-level issue codes and severities emitted by Task 2 (Task 4 owns the final policy table):
  - `malformed_lead` (blocking) — id/account/pipeline/status missing or invalid; result `rejected`.
  - `account_mismatch` (blocking) — payload account differs from context; result `rejected`.
  - `invalid_created_at` (blocking) — missing/invalid `created_at`; result `rejected` (SPEC M5.6: raw kept, lead excluded from aggregates).
  - `invalid_updated_at` (blocking) — missing/invalid `updated_at` (`leads.source_updated_at` is NOT NULL); result `rejected`.
  - `out_of_scope_pipeline` (warning) — payload pipeline differs from config; result `excluded`.
  - `unknown_current_status` (blocking) — status not among known statuses of the configured pipeline; lead still normalized.
  - `unknown_channel` (warning), `channel_rule_conflict` (warning).
  - `missing_responsible` (warning) — no valid responsible user.
  - `won_without_valid_price` (blocking) — current status is won and price is missing, invalid or zero (zero requires a versioned rule that does not exist yet, catalog §4.4).
  - `invalid_price` (warning) — non-won lead with a present but invalid price. A non-won lead with no price stores `null` without an issue.
- R5 Empty/whitespace name → `Сделка #<id>` without issue. A name is phone-like when it has ≥10 decimal digits (a full Russian national number) and digits are at least half of its non-whitespace characters; the stored `name` keeps the source text (protected normalized record), while `displayName` becomes `Сделка #<id>`.
- R6 `amoUrl` = `https://555151.amocrm.ru/leads/detail/<id>` (confirmed subdomain, numeric id only). `isDeleted` is always `false` here (two-pass deletion belongs to reconciliation).
- R7 Issue `safeDetails` never contain names, phones, tag/field text or raw payload fragments — only fixed reason codes and numeric IDs.
- R8 Unix timestamps are valid only as positive safe integers up to `253402289999` (9999-12-31T20:59:59Z), so the Moscow business date always keeps a four-digit year; `toMoscowDate` rejects later instants and expanded-year strings.
- R10 (review fix round 1) A present non-text source-field value fills the field and yields `unknown` (`unmapped_source_field`); a valid lead from another pipeline is `excluded` before timestamp/status validation; names without visible characters use the fallback; digit runs of ten or more digits inside a displayed name are masked as `*** ***-**-NN` (SECURITY_READ_ONLY §7); ISO offsets must be real quarter-hour offsets up to 14:00 and instants must not precede the unix epoch.
- R11 (review fix round 2) Phone separators include whitespace, every dash (`\p{Pd}`), minus sign, invisible format characters (`\p{Cf}`) and `( ) . + / _ , :`. Context rules with an empty value or a NUL character are rejected, so the non-text sentinel can never match. Over-masking of other long digit runs (dates with times, INN, large sums) is accepted: it only affects display and fails toward privacy.
- R9 Invalid context (non-positive IDs, bad normalization time) is a programmer error and throws `AppError(E_VALIDATION)`; raw data never throws.

## Verification

- Red: `pnpm vitest run packages/domain/src/leads/normalize-lead.test.ts packages/domain/src/leads/channel.test.ts` fails on missing modules.
- Green/property: `pnpm vitest run packages/domain/src && pnpm test:contracts`.
- Controller gate (Node 22): `supabase db reset`, `pnpm test:integration`, `pnpm test:security`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:secrets`, `git diff --check`.

## Constraints

No network, no DB, no live amoCRM/Google, switches stay false, no real payloads or PII in fixtures, Task 3 not started.
