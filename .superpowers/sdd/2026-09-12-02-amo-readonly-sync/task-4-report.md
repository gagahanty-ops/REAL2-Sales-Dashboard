# Task 4 report — versioned amoCRM pipeline/channel configuration

## Summary

- Added PostgreSQL migration `0004_amo_configuration.sql` (Task 3 already owns `0003`) with immutable versioned pipeline configs, exact channel rules, immutable validation history, a single-active-version partial index, queued recalculation requests, RLS, and least-privilege grants.
- Added domain contracts for discovery, candidate validation, deterministic SHA-256 metadata checksums, exact catalog channel rules, duplicate rejection, and source-type priority enforcement.
- Added an atomic repository activation transaction. It locks the connection and its config rows, validates rules, increments the version, deactivates the prior version, inserts immutable config/rules/validation rows, and queues recalculation. Any failure rolls the transaction back.
- Added five safe API routes: discovery, current, validate, activate, and channel-values. Discovery uses only Task 1 `amoFetch` guarded GET requests with the active server-side connection/token. Activation performs fresh discovery and optimistic checksum comparison before the transaction.
- Added admin-only pipeline/channel settings and an admin/head read-only quality screen. The quality screen compares the active version to live guarded GET metadata and reports name/ID/checksum drift without exposing credentials.
- Preserved both disabled external switches. No real amoCRM, Google API, protected Sheet, or live credential was used.

## Files

- `.superpowers/sdd/2026-09-12-02-amo-readonly-sync/task-4-report.md`
- `supabase/migrations/0004_amo_configuration.sql`
- `packages/domain/src/amo/config.ts`
- `packages/domain/src/amo/config.test.ts`
- `packages/domain/src/index.ts`
- `packages/db/src/amo-config.ts`
- `packages/db/src/index.ts`
- `apps/web/src/lib/amo/config-discovery.ts`
- `apps/web/src/lib/amo/config-public.ts`
- `apps/web/src/app/api/config/discovery/route.ts`
- `apps/web/src/app/api/config/current/route.ts`
- `apps/web/src/app/api/config/validate/route.ts`
- `apps/web/src/app/api/config/activate/route.ts`
- `apps/web/src/app/api/config/channel-values/route.ts`
- `apps/web/src/app/api/config/config.integration.test.ts`
- `apps/web/src/components/pipeline-config-manager.tsx`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/app/settings/pipeline/page.tsx`
- `apps/web/src/app/settings/channels/page.tsx`
- `apps/web/src/app/quality/config/page.tsx`
- `apps/web/src/app/globals.css`
- `tests/security/rls.security.test.ts`

## Behavior and security review

- Pipeline `10243278`, statuses `11`/`99`, and field `77` occur only in synthetic tests. Production code hard-codes only the required Russian names and validates every selected ID against live API discovery.
- Pipeline discovery calls only `GET /api/v4/leads/pipelines`, child status GET paths, `GET /api/v4/leads/custom_fields`, and `GET /api/v4/users`, all through `amoFetch`; routes never call amoCRM directly.
- The active token remains server-side. Public config serialization excludes connection IDs, actor IDs, ciphertext, tokens, and validation details that could expose secrets.
- Application and won statuses must be different and belong to the selected API-confirmed pipeline. PostgreSQL independently rejects identical status IDs.
- Channel rules use only exact match types. The complete catalog variants are required as `source_field_exact` rules. Duplicate `(match_type, match_value)` and duplicate priorities are rejected by domain validation and SQL. Rule source priority is field, then tag, then integration. Unknown/unconfirmed values remain the `unknown` fallback; no substring or free-text inference exists.
- If no source field is selected, required field rules remain immutable history but are inserted inactive, allowing later tag/integration rules without pretending the field exists.
- Activation uses an advisory transaction lock plus row locks, a unique active-version index, and immutable-history triggers. A forced foreign-key failure after prior-version deactivation proved rollback restores the old active version.
- Activation inserts only a queued recalculation request. It does not update any current snapshot or enable sync/publishing.
- RLS tests prove admin/head can read only the active safe projection, managers see no configuration, anonymous/direct authenticated writes remain denied, and existing security defaults remain intact.
- The config integration suite now cleans its own immutable fixtures so it cannot contaminate OAuth/user suites.

## TDD evidence

### RED

1. Domain priority test failed because tag/integration rules could precede source-field rules: `expected function to throw an error, but it didn't`.
2. Integration test without a source field failed because all 14 `source_field_exact` rules were stored active instead of inactive.
3. Domain catalog test failed because tag rules could masquerade as the required source-field catalog.
4. PostgreSQL defense test failed because identical application/won status IDs were accepted: `promise resolved "[]" instead of rejecting`.
5. The first full integration run exposed leaked immutable fixtures from the new suite, causing 21 FK cleanup failures in existing OAuth/user/identity suites.

### GREEN

- Domain focus: 8/8 passed.
- Config integration focus after clean reset: 9/9 passed.
- Full unit/repository tests: 12/12 Node tests and 68/68 Vitest unit tests passed.
- Contracts: no contract files yet; command exited 0 with `--passWithNoTests`.
- Full integration: 39/39 passed across 5 files.
- Security: 15/15 passed across RLS and log-redaction suites.
- Local Supabase reset applied migrations `0001` through `0004` successfully on the configured PostgreSQL 17 environment.
- Lint, typecheck, production build, diff whitespace check, and secret-path scan passed.

## Final commands

All package-manager commands used the required Node/pnpm runtime. The final fresh sequence was:

```text
pnpm exec supabase db reset
pnpm test
pnpm vitest run --project contracts --passWithNoTests --silent
pnpm vitest run --project integration --silent
pnpm vitest run --project security --silent
pnpm lint
pnpm typecheck
pnpm build
pnpm check:secrets
```

## Concerns / follow-up boundary

- `GET /api/config/channel-values` truthfully returns an empty list until Task 4+ raw/sync storage exists; the channel screen communicates this empty state. It does not fabricate counts from catalog defaults.
- A live `/quality/config` comparison requires an active server-side amoCRM connection. If metadata is unavailable, the screen falls back to the stored safe projection and explicitly reports the live check as unavailable.
- No production ID has been activated. First activation remains blocked until the named pipeline/statuses and optional source field are confirmed by the guarded API discovery flow.

## Fix round 1

### Summary

- Bound every activation request to `expectedActiveConfigId` and compare that value with the active row while holding the connection advisory lock and configuration row locks. Concurrent or stale requests that validated the same checksum can no longer both create versions; the loser receives `E_CONFLICT` / HTTP 409.
- Added an ID-preserving metadata rename path. Initial setup still requires `РЕАЛ ДВА`, `Завершение (самовывоз или доставка)`, and `Успешно реализовано`. After those IDs have been confirmed, a changed live name produces explicit warning codes and `requiresNameConfirmation`; activation stores the new names only when the admin submits `confirmNameChanges: true`.
- Replaced the static channel-rule table with an admin editor for exact source-field, tag, and integration-source rules. It edits priority, exact value, and normalized channel; rejects empty values, duplicate exact keys, duplicate priorities, and source-order inversions before submission; revalidates live metadata; and activates a new immutable version with the edited payload.
- Preserved customized rules when a later pipeline version is activated from the pipeline screen instead of resetting to catalog defaults. Both settings screens update their expected active ID after success.
- Rejected duplicate pipeline IDs, duplicate status IDs within a pipeline, and duplicate lead-custom-field IDs at the aggregate discovery schema boundary, including identical and conflicting duplicates. Guarded discovery now parses the aggregate before returning it, eliminating response-order-dependent `.find()` behavior.
- Updated the read-only quality page to evaluate live metadata against the active confirmed names, so a pending rename is displayed as drift while an already-confirmed renamed version no longer remains permanently invalid.

### Files changed

- `packages/domain/src/amo/config.ts`
- `packages/domain/src/amo/config.test.ts`
- `packages/db/src/amo-config.ts`
- `apps/web/src/lib/amo/config-discovery.ts`
- `apps/web/src/lib/amo/config-public.ts`
- `apps/web/src/app/api/config/validate/route.ts`
- `apps/web/src/app/api/config/activate/route.ts`
- `apps/web/src/app/api/config/config.integration.test.ts`
- `apps/web/src/components/pipeline-config-manager.tsx`
- `apps/web/src/components/channel-rules-manager.tsx`
- `apps/web/src/components/channel-rules-manager.test.tsx`
- `apps/web/src/app/settings/channels/page.tsx`
- `apps/web/src/app/quality/config/page.tsx`
- `apps/web/src/app/globals.css`
- `.superpowers/sdd/2026-09-12-02-amo-readonly-sync/task-4-report.md`

### Covering tests

- `packages/domain/src/amo/config.test.ts`: initial-name enforcement, same-ID rename warnings, resolved renamed names, and duplicate pipeline/status/custom-field rejection.
- `apps/web/src/app/api/config/config.integration.test.ts`: aggregate duplicate-discovery rejection; concurrent same-checksum activation with exactly one 200 and one 409; validate/activate rename warning and explicit confirmation; immutable storage of renamed names; activation of edited exact source-field/tag/integration rules; rollback and stale-checksum behavior.
- `apps/web/src/components/channel-rules-manager.test.tsx`: editable controls for all three exact evidence sources, expected-active-ID payload binding, and duplicate/priority/order client validation.
- `tests/security/rls.security.test.ts` and `tests/security/log-redaction.security.test.ts`: unchanged RLS/default-deny and safe-log guarantees after the new public config ID and activation contract.

### RED evidence

1. `node "$REAL2_PNPM" exec vitest run packages/domain/src/amo/config.test.ts --project unit` — 4 failed / 8 passed: same-ID rename stayed invalid and duplicate pipeline/status/custom-field IDs were accepted.
2. `node "$REAL2_PNPM" exec vitest run apps/web/src/components/channel-rules-manager.test.tsx --project unit` — suite failed because the editable channel-rule component and payload helpers did not exist.
3. `node "$REAL2_PNPM" exec vitest run apps/web/src/app/api/config/config.integration.test.ts --project integration` — 9 failed / 4 passed before production wiring: duplicate discovery returned 200, activation did not accept the state binding, rename validation stayed invalid, and the editable three-source payload could not activate.
4. The first affected lint run reported one unused editor destructuring binding; it was removed before final verification.

### GREEN evidence and exact commands

Every package-manager invocation used:

```text
export PATH=/Users/arlandorizzi/.npm/_npx/d8d805b81e5239f8/node_modules/node/bin:$PATH
REAL2_PNPM=/Users/arlandorizzi/.npm/_npx/d8d805b81e5239f8/node_modules/pnpm/bin/pnpm.cjs
```

Fresh database and focused regressions:

```text
node "$REAL2_PNPM" exec supabase db reset
node "$REAL2_PNPM" exec vitest run packages/domain/src/amo/config.test.ts apps/web/src/components/channel-rules-manager.test.tsx --project unit --silent
node "$REAL2_PNPM" exec vitest run apps/web/src/app/api/config/config.integration.test.ts --project integration --silent
```

Relevant output:

- Node `v22.23.2`; Supabase reset successfully reapplied migrations `0001` through `0004` on the local PostgreSQL 17 stack.
- Focused unit: 2 files passed, 15 tests passed.
- Focused config integration: 1 file passed, 13 tests passed.

Full affected verification:

```text
node "$REAL2_PNPM" test
node "$REAL2_PNPM" exec vitest run --project integration --silent
node "$REAL2_PNPM" exec vitest run --project security --silent
node "$REAL2_PNPM" lint
node "$REAL2_PNPM" typecheck
node "$REAL2_PNPM" build
node "$REAL2_PNPM" check:secrets
git diff --check
```

Relevant output:

- Repository/worker checks: 12/12 passed; Vitest unit: 75/75 passed across 13 files.
- Full integration: 43/43 passed across 5 files.
- Security: 15/15 passed across RLS and log-redaction suites.
- All six workspace package lint and typecheck tasks passed; scripts typecheck passed.
- All packages and the Next.js production application built successfully; all 17 pages were generated and the config/settings/quality routes were present.
- Tracked-secret scan and whitespace check exited 0.

### Self-review

- The stale-state comparison occurs after the transaction advisory lock and after locking every configuration row for the connection. A `Promise.all` route regression produced `[200, 409]` and exactly one version, demonstrating that a shared fresh checksum is insufficient without the one-use active-state binding.
- Name drift is allowed only when the relevant pipeline/status ID belongs to the active confirmed selection. A different or initially unconfirmed ID with a non-required name remains `E_CONFIG_INCOMPLETE`. Confirmation is checked after a fresh discovery/checksum comparison and before any write.
- Edited channel rules remain server-authoritative: Zod constrains exact match types/channels, domain validation enforces catalog defaults/duplicates/priorities/source order, SQL independently enforces unique keys/priorities, and the transaction inserts an immutable new version.
- The current configuration UUID is intentionally exposed only as a safe optimistic-concurrency token; connection IDs, actor IDs, credentials, ciphertext, and private validation details remain excluded.
- Activation still inserts only a queued recalculation request and does not touch the current snapshot. Both external switches remain false.

### Concerns / follow-up boundary

- Encountered channel values and counts remain truthfully empty. `/api/config/channel-values` still returns no fabricated aggregate because the immutable raw table is not available until Task 5.
- No production ID, live amoCRM credential, real network call, Google API, or protected original Sheet was used. All amended integration evidence is synthetic and local.
