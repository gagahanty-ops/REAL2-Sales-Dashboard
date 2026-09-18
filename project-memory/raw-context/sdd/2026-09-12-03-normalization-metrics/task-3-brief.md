# Task 3 brief: derive stage and responsibility timelines and milestones

Plan: `docs/superpowers/plans/2026-09-12-03-normalization-metrics.md` §Task 3.
Authority: `SPEC.md` M5 (M5.2 schema, M5.5 business logic, M5.6 edge cases) and
`METRICS_CATALOG.md` §4.2, §4.3, §6, §8, §11.
Start commit: `6dfd2a7` on `feat/foundation-access`, full gate green.

## Scope

- Create `packages/domain/src/leads/build-history.ts` (+ tests): pure derivation
  of ordered stage/responsible timelines, milestones, stage durations and
  history quality issues, plus tolerant extraction of history events from raw
  amoCRM event payloads.
- Create `packages/db/src/normalize-run.ts`: transactional repository that reads
  one successful sync run's raw rows and writes the normalized layer.
- Create `apps/worker/src/jobs/normalize-sync-run.ts` (+ integration test):
  orchestration that joins `normalizeLead` (Task 2) with `buildLeadHistory` and
  the repository.
- Raw tables are never edited. Both external switches stay `false`.

## Preflight rulings

- **R1 — event ordering.** Events are ordered by canonical instant, then by
  `amo_event_id` compared as a string, exactly as SPEC M5.5 and the plan state.
  Timestamps are canonicalized with Task 2's `parseIsoInstant`, so different
  source spellings of one instant cannot reorder the history.
- **R2 — duplicates.** A repeated `amo_event_id` keeps the first occurrence in
  sorted order and raises `duplicate_event` (`info`). The database unique index
  already makes the write idempotent; the issue exists because
  `METRICS_CATALOG.md` §11 requires `duplicate_event_count`.
- **R3 — milestone responsibility.** `lead_stage_events.responsible_user_id` is
  the responsible in effect at that instant, derived from the responsible-event
  timeline, not the amoCRM user who clicked (`created_by`), which is not the
  responsible and is often a robot. With no responsible history, the value is
  the responsible at creation.
- **R4 — responsible at creation.** The `from_user_id` of the earliest
  responsible event; with no such event, the current snapshot's responsible.
  Nothing is invented when both are absent (`null`).
- **R5 — first observation wins.** `application_at` and `won_at` are the first
  stage events into the configured statuses; re-entry never creates a second
  milestone (SPEC M5.5). `currently_won` comes from the snapshot's current
  status, so a returned lead leaves `payments` while its history stays
  (`METRICS_CATALOG.md` §4.3).
- **R6 — missing history.** `missing_stage_history` (`blocking`) is raised when
  the snapshot implies a milestone that no event proves: the lead is currently
  won without a won event, or its current status sorts at or after the
  application status without an application event. A milestone is never
  invented from the current status (`METRICS_CATALOG.md` §4.2).
- **R7 — conflicting history.** A stage event whose `from_status_id` contradicts
  the previous event's `to_status_id`, or two events at one instant moving to
  different statuses, raise `stage_history_conflict` (`warning`). The order still
  follows R1, as SPEC M5.6 requires.
- **R8 — durations.** A closed stay is the interval between the event entering a
  status and the next stage event; the open stay is measured against the run's
  snapshot instant (`METRICS_CATALOG.md` §8). With no stage events there is no
  current-stage age: an entry instant is never fabricated from `created_at`.
- **R9 — invalid event time.** An event whose instant cannot be parsed is
  dropped from the timeline and raises `invalid_event_time` (`blocking`); it is
  never written to the derived tables.
- **R10 — a lead that left the pipeline (revised during implementation).** A
  first attempt deleted the stored rows. That is wrong twice over:
  `METRICS_CATALOG.md` §11 states that no problematic lead is ever removed from
  the raw or normalized layer, and Task 1's approved security test keeps the
  worker without update or delete privileges on the derived history. The rule
  is therefore: a stored lead whose newest snapshot is `excluded` keeps its row
  and its history, and its `out_of_scope_pipeline` issue is escalated from
  `warning` to `blocking` with `stored: 1`, so a stale lead cannot reach a
  published report unnoticed while Task 4's reconciliation decides its fate. A
  lead that was never stored is simply not written, with the warning issue.
  This answers the open Task 2 handoff question.
- **R11 — a rejected snapshot.** A `rejected` result (malformed payload, invalid
  `created_at`/`updated_at`, unknown current status) leaves the previously
  stored row untouched and opens the blocking issue, which is SPEC M5.6's
  "остановка snapshot".
- **R12 — statuses.** `pipeline_statuses.is_won` is `status_id =
  config.won_status_id` and `is_closed` equals it; amoCRM's undocumented status
  `type` field is not guessed. `sort_order` uses the payload's `sort` when it is
  a safe integer, otherwise `0`.
- **R13a — append-only derived history.** `lead_stage_events` and
  `lead_responsible_events` are inserted with `on conflict do nothing` and are
  never rewritten: the worker holds no update or delete grant on them, and
  Task 1's security test pins that invariant. Recalculated attribution lives in
  `lead_milestones`, which the worker may update. A stage row therefore keeps
  the responsible derived when it was first written, while the milestone
  follows a late handover.
- **R13 — transaction boundary.** One run is one transaction (SPEC M5.5), so a
  failure anywhere leaves every previously normalized row intact.
- **R14 — history issue codes.** History codes live in `build-history.ts`
  (`HISTORY_ISSUE_SEVERITY`) next to the logic that raises them, and reuse Task
  2's `LeadQualitySeverity`. Task 2's approved `LEAD_ISSUE_SEVERITY` is left
  untouched; Task 4's policy will union both catalogues.

## Definition of done

- Red evidence before implementation, green afterwards, mutations detected.
- `pnpm test`, `pnpm test:integration`, `pnpm test:security`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, `pnpm check:secrets`
  and `supabase db lint --fail-on error` all pass on the live local database.
