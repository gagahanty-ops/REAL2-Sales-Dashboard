# Task 7 report — amoCRM static safety gate

Date: 2026-09-17

## Delivered

- `packages/testkit/src/source-scan.ts`: deterministic TypeScript source inventory and forbidden-pattern scanner.
- `tests/security/amo-imports.security.test.ts`: rejects alternate production amoCRM HTTP clients outside the guarded transport.
- `tests/security/amo-methods.security.test.ts`: rejects production POST/PATCH/PUT/DELETE call sites, with one exact OAuth token-exchange exception.
- `docs/runbooks/amo-oauth-installation.md`: external OAuth-only installation checklist with support-preservation gate.
- `docs/runbooks/amo-sync-disable.md`: environment + DB kill-switch, evidence, revocation, and recovery procedure.

## TDD evidence

- RED: focused security run failed because `listTypeScriptFiles` was not implemented/exported.
- GREEN: focused and complete security run passed 20/20.

## Full verification

Runtime: Node 22.23.2.

- lint: PASS
- typecheck: PASS
- repo/worker: 16/16 PASS
- unit: 110/110 PASS
- contracts command: PASS (no contract files)
- integration: 80/80 PASS
- security: 20/20 PASS
- build: PASS
- tracked-secret scan: PASS
- `git diff --check`: PASS

## Safety statement

No live credentials were used. No OAuth installation, amoCRM request, Google API
request, or write to protected spreadsheet
`123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks` occurred. Production/staging
switches were not enabled.
