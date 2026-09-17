# REAL2 Sales Dashboard

## Mission

Build a read-only analytics mirror for the REAL2 sales team. The application reads amoCRM through an external OAuth integration, computes cohort metrics by lead creation date, serves a private dashboard, and may publish only to an explicitly approved copy of the existing Google Sheet.

## Normative documents

Read these before changing code:

1. `SPEC.md` — system behavior and interfaces.
2. `METRICS_CATALOG.md` — the only normative source for formulas.
3. `SECURITY_READ_ONLY.md` — mandatory integration safety contract.
4. The active plan under `docs/superpowers/plans/`.

When code and documentation disagree, stop and update the specification through review before changing behavior.

## Non-negotiable constraints

- Use external amoCRM OAuth; never create or request a private integration.
- amoCRM business API permits only `GET`. The sole amoCRM `POST` is exactly `/oauth2/access_token`.
- Every amoCRM request goes through `amoFetch` and exact host `555151.amocrm.ru`; no generic proxy and no direct business-API `fetch`.
- Never send `PATCH`, `PUT`, or `DELETE` to amoCRM.
- Never write to spreadsheet `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`.
- Google publication requires both `SHEET_PUBLISH_ENABLED=true` and the DB control `sheet_publish_enabled=true`.
- amoCRM sync requires both `SYNC_ENABLED=true` and the DB control `sync_enabled=true`.
- Both DB controls start disabled. Production secrets never enter git, logs, client bundles, fixtures, or chat.
- `report_date` always equals the lead `created_date` in `Europe/Moscow`.
- Partial syncs never replace the current approved snapshot.
- Unknown or malformed source data is quarantined and counted; it is never silently discarded or guessed.

## Architecture

- `apps/web`: Next.js UI and route handlers.
- `apps/worker`: scheduled sync, normalization, snapshots, alerts, and Sheet publication.
- `packages/domain`: Zod contracts, metrics, dates, roles, and error codes.
- `packages/db`: PostgreSQL client, repositories, transactions, and generated database types.
- `packages/integrations`: guarded amoCRM and Google clients.
- `packages/testkit`: synthetic fixtures, mock upstream servers, and golden datasets.
- `supabase/migrations`: ordered SQL migrations and RLS policies.
- `docs/runbooks`: operator procedures and release evidence.

## Working method

1. Read the relevant approved spec and plan task.
2. Write the smallest failing test that proves the required behavior.
3. Run it and record the expected failure.
4. Implement only enough production code to pass.
5. Run focused tests, then repository-wide checks.
6. Review the diff for secrets, PII, integration methods, and protected IDs.
7. Commit one independently reviewable change.

Do not combine schema, integration, metric, and UI behavior in one unreviewable commit.

## Required checks

Before every commit that can affect integrations or metrics, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
```

Before a release candidate, additionally run:

```bash
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm build
```

## Definition of done

- Tests demonstrate success and relevant failure modes.
- API responses include a safe `trace_id`; logs contain no tokens, full phones, names, query values, or raw payloads.
- RLS negative tests use existing rows and prove forbidden reads return nothing.
- Retry, idempotency, stale-data, empty, error, and loading behavior are verified where applicable.
- Documentation and runbooks are updated in the same commit as behavior.
- No production switch is enabled by code or migration.
