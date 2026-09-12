---
name: real2-release-evidence
description: Use when preparing staging, shadow mode, or production release evidence for the REAL2 dashboard.
---

# REAL2 Release Evidence

1. Create a dated evidence directory under `docs/runbooks/release-evidence/`.
2. Record commit SHA, lockfile hash, migration version, environment name, and tester.
3. Run lint, typecheck, unit, contract, integration, security, E2E, and build checks.
4. Rehearse both kill switches and prove outbound request counters stay zero.
5. Rehearse protected Sheet denial and forbidden amoCRM method denial.
6. Restore a recent staging backup and run golden reconciliation.
7. Compare every shadow day by lead, application, payment, revenue, manager, and channel.
8. Link written amoCRM support confirmation and owner approval without copying secrets or personal data.
9. Return GO only if every mandatory gate passes; otherwise return NO-GO with exact blockers.

The skill never changes a production switch or publishes to any Sheet.
