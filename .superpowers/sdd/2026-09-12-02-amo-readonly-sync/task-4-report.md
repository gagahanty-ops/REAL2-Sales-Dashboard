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
