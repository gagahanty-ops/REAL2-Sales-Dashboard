# {{feature_name}} — feature specification

> Parent specification: `SPEC.md`, module {{module_id}}.
>
> Status: draft → review → approved → implemented → verified.

## 1. Outcome and non-goals

Describe the observable user outcome, measurable acceptance result, explicit exclusions, and the approved owner.

## 2. User stories

Provide at least five role-specific stories including happy path, denied access, empty data, upstream failure, and repeated action.

## 3. Data contract

Define exact SQL migrations, keys, constraints, indexes, retention, RLS policies, and rollback behavior.

## 4. Interfaces

Define exact method, path, Zod request schema, response schema, error codes, authorization, pagination, idempotency, and examples.

## 5. Screens and states

Define routes, components, Russian copy, filters, loading, error, empty, success, stale data, responsive behavior, keyboard use, and accessibility.

## 6. Business logic

Define deterministic ordered rules, formulas, date/timezone behavior, transaction boundaries, retries, quality gates, and audit events.

## 7. Edge cases

List malformed, duplicate, concurrent, missing, stale, partial, zero, boundary-date, permission, and upstream-error cases with exact outcomes.

## 8. Security

List data classification, external hosts/methods/paths, secret handling, log redaction, fail-closed checks, kill switches, and negative tests.

## 9. Observability

Define safe structured logs, metrics, traces, alerts, thresholds, health effects, and operator action.

## 10. Test evidence

Provide named unit, integration, contract, security, E2E, migration, rollback, and performance cases with commands and expected results.

## 11. Dependencies and artifacts

List exact files, interfaces consumed and produced, migration ordering, documentation, release evidence, and downstream tasks.
