# Task 2 — secure amoCRM OAuth credentials

## Scope and safety boundary

Implemented local OAuth-state persistence, application-level encrypted token storage, and server-side token rotation for the approved amoCRM integration. Sync and publishing switches remain disabled, and this work made no real amoCRM, Google, or production-database request. No credentials, authorization codes, token values, or raw OAuth response bodies are written to this report, application logs, browser-facing projections, or plaintext database columns.

## Interrupted-work audit

The inherited partial changes already covered the required migration, environment validation, AES-256-GCM format, guarded token exchange, repository projections, and worker token provider. I retained those changes after validating them against `SPEC.md` M2 and `SECURITY_READ_ONLY.md`.

The audit found two gaps:

1. Rotation held a row lock but not the required transaction-scoped advisory lock per connection.
2. The concurrent in-process refresh case could issue two upstream exchanges depending on scheduling.

The completed implementation adds a PostgreSQL transaction advisory lock derived from the connection ID and an in-flight refresh coalescer. The first caller locks, exchanges, encrypts, and atomically persists the replacement pair; concurrent callers receive that completed replacement. Later explicit refreshes remain independent operations.

## Delivered behavior

- One-time random OAuth states are SHA-256 stored, expire after ten minutes, and are atomically consumed; expiry retention is purged after 24 hours.
- The migration creates the specified connection state enum and state/connection tables under RLS. User-facing roles receive only the safe status projection; ciphertext and OAuth-state columns are denied. `service_worker` retains server-only database access.
- Token encryption is AES-256-GCM with an exact 32-byte decoded key, random IV per encryption, and an authentication tag in each ciphertext blob.
- OAuth code exchange and refresh both use Task 1's guarded `amoFetch` token POST policy: exact endpoint, no bearer header, redirect errors, schema validation, and audit entries without body/query/token data.
- Refresh locks the connection, decrypts only server-side, exchanges the current refresh token, encrypts both replacements, and updates expiry/refresh timestamps atomically. Failure transitions the connection to `reauth_required`; the token provider then rejects new use.
- Disconnect overwrites both ciphertext columns with independently random bytes before marking the connection disabled.
- Required OAuth settings are server-only and `.env.example` contains local placeholder values only. The worker CLI fixture now supplies the expanded synthetic environment while its network flags remain false.

## Test-driven evidence

The inherited focused test began with a real concurrency failure: two concurrent refresh calls reached the mocked upstream exchange. I added an advisory-lock regression test, observed it fail because no advisory lock existed, then added the lock and in-flight coalescing; the focused suite passed afterward. The final focused suite covers state replay/expiry/retention, authenticated encryption, guarded OAuth exchange/redaction, safe serialization, random-byte disable, advisory locking, concurrent rotation, later explicit refresh, reauthorization on failure, the ten-minute boundary, and token-provider state gating.

## Verification

- `supabase db reset` applied migrations `0001_identity_and_controls.sql` and `0002_amo_oauth.sql` successfully on the local database.
- `vitest run packages/integrations/src/amo/oauth.test.ts`: 15 passed.
- `pnpm test:security`: 12 passed, including explicit credential-column and OAuth-state denial checks.
- `pnpm test`: 10 Node tests and 58 Vitest unit tests passed.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm check:secrets` passed.
- `git diff --check` passed.

## Self-review

Reviewed the transport call path, migration grants/RLS policy, ciphertext projections, lock scope, error mapping, redaction assertions, and disabled network controls. No direct global amoCRM fetch, bearer OAuth exchange, redirect following, unsafe logging, Google access, sync invocation, or publishing invocation was introduced.

## Concern

No implementation concern remains for Task 2. Production installation still requires the account owner to supply distinct secret-store values and the documented external-support confirmation; neither was requested or attempted here.

## Fix round 1

### Changes

1. OAuth-state retention now has a production caller: every worker CLI run creates its database client, purges OAuth states past the retention cutoff, emits the safe idle result when both network switches remain disabled, and closes the client in `finally`.
2. Added `createServiceWorkerDbClient`. It sets the PostgreSQL startup role to `service_worker` for every connection, and the worker CLI uses this client rather than the general database factory. The security test verifies the effective role and that it cannot select application-user rows.
3. Declared the schema validator used by the OAuth response parser as an integrations runtime dependency and updated the lockfile.
4. Added the four required OAuth environment placeholders to shared local Compose configuration. They are fixed synthetic local values; network switches remain literal `false`.

### Covering regression tests

- `apps/worker/src/main.test.mts`: verifies retention client creation, one purge call, and `finally` closure without enabling a network integration.
- `tests/security/rls.security.test.ts`: verifies a fresh worker client has `current_user = service_worker` and cannot read `app_users`.
- `tests/repo/workspace.test.mjs`: verifies both manifest and lockfile carry the integrations runtime dependency.
- `tests/repo/container-safety.test.mjs`: verifies Compose includes the required local placeholders while preserving disabled network controls.
- `packages/integrations/src/amo/oauth.test.ts`: continues to cover retention cutoff behavior against the local PostgreSQL database.

### Commands and relevant output

```text
supabase db reset
Finished supabase db reset; migrations 0001_identity_and_controls.sql and 0002_amo_oauth.sql applied.

pnpm test
12 Node tests passed; 58 Vitest unit tests passed.

pnpm test:security
13 security tests passed.

pnpm typecheck && pnpm lint && pnpm check:secrets
All commands exited successfully.

docker compose config --quiet
Exited successfully.
```

`pnpm build` also completed successfully before the final test pass. A later full `docker compose --profile worker build worker` reached the compiled/deployed worker image stages but the local Docker daemon failed writing its overlayfs metadata database with an input/output error. This is host Docker storage state, not an application assertion failure; the checked Compose config and its regression test passed. No container was run after that daemon failure.
