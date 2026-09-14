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
