# Task 3 report — external amoCRM OAuth administration

## Summary

Completed the admin-only OAuth administration surface for the fixed synthetic
amoCRM account `555151.amocrm.ru`.

- Added admin-only status, start, callback, refresh, and disconnect routes.
- The callback authenticates first, consumes the one-time state, performs the
  guarded token exchange, verifies `GET /api/v4/account`, enforces account ID
  `555151` plus subdomain and host, encrypts both tokens, and redirects only to
  the local allowlist.
- Added an admin-only settings page that shows only account ID, subdomain,
  status, expiry, and last checked time. Browser code never receives a token,
  client secret, ciphertext, authorization code, or raw upstream response.
- Reused the Task 2 locked refresh behavior through a shared integrations
  export, so the worker and the admin refresh route use the same server-side
  implementation.
- Disconnect overwrites local ciphertext through the repository and makes no
  amoCRM request.

All values exercised by tests are synthetic. No real amoCRM, Google API, or
protected spreadsheet access was attempted; sync and publish switches remain
disabled.

## Files

- `apps/web/src/app/api/integrations/amo/{status,start,callback,refresh,disconnect}/route.ts`
- `apps/web/src/app/api/integrations/amo/oauth.integration.test.ts`
- `apps/web/src/app/settings/integrations/amo/page.tsx`
- `apps/web/src/components/amo-integration-manager.tsx`
- `apps/web/src/lib/amo/admin.ts`
- `packages/db/src/amo-connections.ts`, `packages/db/src/index.ts`
- `packages/integrations/src/amo/refresh.ts`, `packages/integrations/src/index.ts`
- `apps/worker/src/jobs/refresh-amo-token.ts`
- workspace package manifests, lockfile, and settings styles.

## RED / GREEN evidence

### RED

After adding the required administration integration cases first, the focused
integration run failed as expected because `./disconnect/route` did not exist:

```text
Cannot find module './disconnect/route'
```

The added cases cover start-state creation, fixed numeric account rejection,
admin authorization, replay prevention, guarded POST/GET behavior, safe status
projection, server-side refresh, and local-only disconnect.

### GREEN

Run with the mandated Node/pnpm runtime:

```text
node "$REAL2_PNPM" test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts
28 integration tests passed

node "$REAL2_PNPM" test:security
13 security tests passed

node "$REAL2_PNPM" test
58 unit tests and 12 repository/worker tests passed

node "$REAL2_PNPM" lint
passed

node "$REAL2_PNPM" typecheck
passed

node "$REAL2_PNPM" build
passed; all five amoCRM API routes and the settings page compiled

node "$REAL2_PNPM" check:secrets
passed
```

## Self-review

- All management endpoints and the settings page call the existing server-side
  admin role check; POST endpoints also require the configured same origin.
- Callback ordering is active admin → one-time state consumption → guarded
  OAuth POST → guarded account GET → exact account verification → encrypted
  local save → allowlisted local redirect.
- Route code has no direct `fetch`, HTTP-client, generic proxy, or redirect
  following. The only production amoCRM network call remains in `amoFetch`.
- OAuth POST receives no bearer token. The only business request in this task
  is the guarded `GET /api/v4/account`; disconnect makes no upstream request.
- The current-status query now selects no token-ciphertext columns. The public
  status mapper removes base URL, installer identity, and all token metadata.
- Response, redirect, and captured-log assertions reject synthetic token,
  secret, code, ciphertext, and callback query material.

## Concerns

- The OAuth authorization URL necessarily contains the one-time `state` query
  value so that the external OAuth protocol can return it. It is never logged,
  persisted in plaintext, reflected by the callback, or included in a local
  redirect; no credential material is present in that URL.
- Production installation, live credentials, and owner confirmation of amoCRM
  support remain deliberately out of scope and were not attempted.

## Fix round 1

### Review fixes

- `start` now creates a state whose redirect target is explicitly
  `/settings/integrations/amo`; an integration test consumes that exact state
  through callback and verifies the resulting local redirect.
- The unsupported assumption that account ID equals subdomain number was
  removed. First install accepts any positive account ID returned from the
  fixed-host/fixed-subdomain account GET; reconnect and refreshed read checks
  compare that returned ID with the stored binding. Fixtures use account ID
  `4242` with subdomain `555151` to prove the distinction.
- Refresh now performs its guarded OAuth POST through the reviewed locked
  refresh implementation, then performs guarded `GET /api/v4/account` with
  the refreshed server-only token. It validates the host/subdomain and stored
  account ID before marking `last_checked_at`.
- Migration `0003_amo_read_check.sql` adds the safe check timestamp. Callback
  sets it after its verified account GET; failed refreshed reads leave it
  unchanged. The public status projection exposes only its ISO timestamp.
- Callback and refresh now share `createAmoAdminAuditSink`, preserving the
  same redacted audit mapping.
- The client reloads the safe status projection after every refresh/disconnect
  outcome and enables refresh/disconnect only for an `active` connection. The
  browser-safe status type/helper is separate from the DB-backed server mapper.

### RED / GREEN evidence

The amended integration cases were run before the fixes and failed as expected:

```text
10 failed / 29 total
first start callback: expected 303, received 409
first install with account ID 4242/subdomain 555151: expected 303, received 409
```

After applying migration `0003` to the local synthetic Supabase database, the
following commands completed successfully with the mandated Node/pnpm runtime:

```text
supabase db reset
Applied migrations 0001, 0002, 0003

node "$REAL2_PNPM" test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts
4 files passed; 30 integration tests passed

node "$REAL2_PNPM" test:security
2 files passed; 13 security tests passed

node "$REAL2_PNPM" test
11 unit files / 60 tests passed; 12 repository-worker tests passed

node "$REAL2_PNPM" lint
passed

node "$REAL2_PNPM" typecheck
passed

node "$REAL2_PNPM" build
passed; web routes and settings page compiled

node "$REAL2_PNPM" check:secrets
passed
```

Covering test files include
`apps/web/src/app/api/integrations/amo/oauth.integration.test.ts` (actual
start state, distinct account ID, refreshed account GET, wrong refreshed
binding, and reauth status),
`apps/web/src/components/amo-integration-manager.test.tsx` (disabled and
reauth action availability), `packages/integrations/src/amo/oauth.test.ts`,
and the existing RLS/log-redaction security tests.
