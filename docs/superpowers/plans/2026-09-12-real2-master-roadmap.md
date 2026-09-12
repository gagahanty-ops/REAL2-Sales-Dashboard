# REAL2 Sales Dashboard Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready, read-only REAL2 sales dashboard that mirrors amoCRM, calculates approved metrics, and can publish only to an approved Google Sheet copy.

**Architecture:** A pnpm monorepo contains a Next.js web/API process, a separate Node.js worker, shared domain/database/integration packages, and synthetic test tooling. PostgreSQL stores append-only source data, normalized history, quality issues, and immutable metric snapshots; external operations fail closed behind explicit policies and disabled-by-default switches.

**Tech Stack:** Node.js 22 LTS, pnpm 10, Next.js 16, React 19, TypeScript 5.9, Tailwind CSS 4, shadcn/ui, Recharts 3, Zod 4, Supabase Pro/PostgreSQL 16, Vitest, PGlite, Playwright, Docker Compose.

**Spec:** `SPEC.md`, with normative `METRICS_CATALOG.md` and `SECURITY_READ_ONLY.md`.

## Global Constraints

- amoCRM integration is external OAuth; a private integration is forbidden.
- amoCRM business API allows only `GET`; the only allowed amoCRM `POST` is exactly `/oauth2/access_token`.
- Every amoCRM request uses `amoFetch` and the exact production host `555151.amocrm.ru`.
- Spreadsheet `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks` is permanently protected from writes.
- Sync and publication each require both their environment switch and database switch; all switches default to false.
- `report_date` always equals the lead creation date in `Europe/Moscow`.
- Money uses PostgreSQL `numeric(14,2)` and decimal-safe application handling.
- Partial or failed runs never replace the current approved snapshot.
- Unknown or invalid source data is preserved and counted; values are never silently guessed or discarded.
- Production secrets remain outside git, logs, browser bundles, fixtures, screenshots, and chat.

---

## Repository map locked by this plan

```text
apps/
  web/                    Next.js routes, server handlers, and dashboard UI
  worker/                 schedules and durable one-shot jobs
packages/
  domain/                 Zod contracts, roles, dates, money, metrics, errors
  db/                     PostgreSQL client, repositories, transaction helpers
  integrations/           guarded amoCRM and Google clients
  testkit/                fixtures, mock servers, golden data, log scanners
supabase/migrations/      ordered DDL and RLS
tests/security/           cross-package safety invariants
docs/runbooks/            deployment, incidents, restore, and release evidence
docs/superpowers/plans/   executable plans
```

## Delivery sequence

| Order | Plan | Independently testable result | Production writes |
|---:|---|---|---|
| 1 | `2026-09-12-01-foundation-access.md` | local web/worker, validated env, DB/RLS, private login, safe API envelope | none |
| 2 | `2026-09-12-02-amo-readonly-sync.md` | external OAuth, guarded GET-only client, config discovery, raw sync using mocks/staging | none |
| 3 | `2026-09-12-03-normalization-metrics.md` | normalized history, quality gates, golden metrics, immutable approved snapshots | none |
| 4 | `2026-09-12-04-dashboard-ui.md` | role-scoped APIs and complete dashboard UI against approved snapshots | none |
| 5 | `2026-09-12-05-sheets-operations-rollout.md` | protected Sheet-copy publisher, monitoring, runbooks, shadow acceptance | copy only after explicit gate |

Plans are executed in order. Within a plan, task order is normative because each interface is consumed by later tasks.

## Review gates

1. **Foundation gate:** RLS negative tests and secret scanning pass before any external OAuth credential is added.
2. **amoCRM safety gate:** forbidden methods and paths prove zero outbound mock requests before staging OAuth installation.
3. **Metric gate:** all golden scenarios match explicit counts and kopecks before real-data reconciliation.
4. **Dashboard gate:** admin/head/manager E2E authorization and four UI states pass before staff access.
5. **Publication gate:** protected ID, layout drift, checksum, and kill-switch tests pass before sharing a Google copy.
6. **Production gate:** 7–14 complete shadow days reconcile with the manual report and have written owner approval.

## Required evidence at completion

- immutable commit SHA and lockfile hash;
- applied migration list and rollback rehearsal result;
- lint, typecheck, unit, contract, integration, security, E2E, and build outputs;
- amoCRM read-only mock-server request ledger;
- protected-Sheet zero-request proof;
- restore rehearsal and last-good-snapshot proof;
- daily shadow reconciliation signed by the business owner;
- written confirmation concerning amoCRM support for the external integration.

Implementation is incomplete while any plan checkbox or review gate remains open.
