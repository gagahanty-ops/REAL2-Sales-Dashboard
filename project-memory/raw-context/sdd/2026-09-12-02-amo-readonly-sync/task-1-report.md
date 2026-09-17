# Task 1 Report — amoCRM read-only transport

## Implementation summary

Implemented the sole guarded amoCRM outbound transport. `assertAmoRequestAllowed` is fail-closed for the exact HTTPS host `555151.amocrm.ru`, allows only the approved business GET paths, and permits exactly one OAuth POST path: `/oauth2/access_token`.

`amoFetch` validates every supplied URL before resolving a bearer token or calling injected `fetchFn`. It forces `redirect: "error"`, strips caller-supplied authorization headers, injects a bearer token only for business GETs, validates response JSON with the supplied Zod schema, and emits only safe audit fields: method, normalized path, response status when available, duration, trace ID, and result. Query values, bodies, credentials, tokens, and response payloads are not included in the audit type or transport logging.

## Files changed

- `packages/integrations/src/amo/policy.ts`
- `packages/integrations/src/amo/transport.ts`
- `packages/integrations/src/amo/types.ts`
- `packages/integrations/src/amo/policy.test.ts`
- `packages/integrations/src/amo/transport.integration.test.ts`
- `packages/integrations/src/index.ts`

## TDD evidence

### RED

The prescribed command first could not start Vitest because the available shell uses Node `v25.8.1` while the repository requires `22.x`:

```text
$ pnpm vitest run packages/integrations/src/amo/policy.test.ts
ERR_PNPM_UNSUPPORTED_ENGINE
Expected version: 22.x
Got: v25.8.1
```

Using a temporary command-scoped engine-check override solely to execute the test runner, the new policy test failed for the expected missing module:

```text
$ pnpm --config.engine-strict=false vitest run packages/integrations/src/amo/policy.test.ts
FAIL packages/integrations/src/amo/policy.test.ts
Error: Cannot find module './policy'
```

After the transport test was added, the combined RED run failed for both missing modules:

```text
$ pnpm --config.engine-strict=false vitest run packages/integrations/src/amo/policy.test.ts packages/integrations/src/amo/transport.integration.test.ts
FAIL policy.test.ts: Cannot find module './policy'
FAIL transport.integration.test.ts: Cannot find module './transport'
```

Self-review then identified missing safe response-status audit coverage. Its test failed before the narrow correction:

```text
$ pnpm --config.engine-strict=false vitest run packages/integrations/src/amo/transport.integration.test.ts
FAIL expected audit entry to include responseStatus: 200
Received entry without responseStatus
```

### GREEN

```text
$ pnpm --config.engine-strict=false vitest run packages/integrations/src/amo/policy.test.ts packages/integrations/src/amo/transport.integration.test.ts
Test Files  2 passed (2)
Tests  22 passed (22)
```

Additional verification:

```text
$ pnpm --config.engine-strict=false --filter @real2/integrations run typecheck
PASS

$ pnpm --config.engine-strict=false --filter @real2/integrations run lint
PASS

$ pnpm --config.engine-strict=false --filter './apps/**' --filter './packages/**' run lint
PASS (all six workspace packages/apps)

$ pnpm --config.engine-strict=false --filter './apps/**' --filter './packages/**' run typecheck
PASS (all six workspace packages/apps)

$ pnpm --config.engine-strict=false exec tsc --noEmit -p scripts/tsconfig.json
PASS

$ pnpm --config.engine-strict=false test:contracts
PASS (no contract test files yet; passWithNoTests)
```

## Self-review

- Confirmed exact host, HTTPS-only, no explicit port, and no URL credentials.
- Confirmed all caller-controlled URLs are policy-checked before token-provider access and network invocation.
- Confirmed OAuth POST does not resolve or send a bearer token.
- Confirmed query parameters are retained for allowed GETs but omitted from audit entries.
- Confirmed forbidden method, path, host, protocol, and redirect override each leave the injected mock ledger at zero requests.
- Confirmed the integration package calls only injected `fetchFn`; it does not import or call global `fetch`.
- Ran `git diff --check`; no whitespace errors. No credentials, production endpoints beyond the specified host, Google APIs, or protected spreadsheet references were added.

## Concerns

No implementation concerns found. Environment verification is limited by the local shell having Node `v25.8.1` and no installed Node 22 binary. The unmodified `pnpm test` reached the existing `tests/repo/workspace.test.mjs` subprocess check and failed only because that subprocess enforces the Node 22 engine. It was not caused by this change; focused tests and all lint/typecheck checks above passed with a temporary command-scoped engine-check override. No network calls, credentials, amoCRM requests, Google API requests, or original-sheet access occurred.
