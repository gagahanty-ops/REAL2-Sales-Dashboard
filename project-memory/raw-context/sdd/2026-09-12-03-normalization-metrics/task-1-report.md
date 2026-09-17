# Task 1 report: normalized lead, history, milestone, and quality schema

## Delivered

- Added migration `0010_normalized_leads.sql` for normalized amoCRM users,
  pipeline statuses, leads, stage/responsible histories, milestones, and
  data-quality issues.
- Enforced lead ownership with composite `(account_id, amo_lead_id)` foreign
  keys from all related history tables.
- Added the required idempotency keys, partial unique open-issue index, and
  access-path indexes.
- Added RLS: admin/head can read normalized rows; managers can read only their
  assigned leads and related stage/responsible/milestone history. Raw payloads
  remain outside manager-facing repositories and policies.
- Added service-worker write access for the normalizer and no user-facing
  write grants.
- Added normalized-lead and quality repositories, exported from `@real2/db`.
- Updated existing integration fixture cleanup to include the new FK graph.

## TDD evidence

1. The new integration invariant test initially failed with
   `relation "public.leads" does not exist`.
2. After the migration, invariants and RLS scope tests passed.
3. The repository test then initially failed because `./leads` did not exist.
4. After repository implementation, the focused repository test passed.

## Verification

- `supabase db reset`
- `pnpm test:integration -- packages/db/src/leads.integration.test.ts`
  - 83 integration tests passed.
- `pnpm test:security -- tests/security/rls.security.test.ts`
  - 23 security tests passed.
- `pnpm lint`
- `pnpm typecheck`

## Environment note

The default Node 25 installation on this host cannot load its expected
`simdjson.31` dynamic library. Verification used the healthy local Node 22
installation via `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; no repository
configuration was changed.

## Round 1 review fixes

- Removed `service_worker` UPDATE access from append-only stage and responsible
  event histories while retaining its required SELECT/INSERT access.
- Made both normalized repositories accept a `Sql` or `TransactionSql`
  connection so a normalizer can roll all writes back together.
- Changed the lead money boundary to a validated two-decimal string, preserving
  PostgreSQL `numeric(14,2)` precision without JavaScript floats.
- Made quality issue counts support account-level (`NULL` lead) issues with
  `IS NOT DISTINCT FROM`.
- Added safe positive-integer validation for repository identities and
  fail-closed bigint mapping for returned quality issue keys.

Round 1 verification after `supabase db reset`:

- Focused normalized integration suite: 6 tests passed.
- Focused normalized RLS suite: 19 tests passed.
- Workspace lint and typecheck passed.
