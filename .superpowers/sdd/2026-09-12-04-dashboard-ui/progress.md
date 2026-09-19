# SDD ledger — plan: docs/superpowers/plans/2026-09-12-04-dashboard-ui.md

## Binding context

- Spec authority: `SPEC.md` M7–M8 and M1 role rules, `METRICS_CATALOG.md`,
  `SECURITY_READ_ONLY.md` §6–7.
- Branch: `feat/foundation-access`; start commit `54d25ab` (Plan 3 complete).
- No production writes; both external switches stay `false`.

## Preflight rulings

- **RD1 — the stack stays the one this repository uses.** The plan's tech stack
  names Tailwind 4, shadcn/ui, Recharts 3 and TanStack Query 5. None of them is
  installed, and five existing pages use the hand-written stylesheet with
  server components. Adding them mid-project would give the product two visual
  languages and two styling pipelines for no requirement that cannot be met
  without them: the daily chart is inline SVG with a table equivalent, and
  keep-previous-data is a small reducer. Recorded as a deliberate deviation.
- **RD2 — SPEC wins over the plan's pseudocode on the wire format.** Query
  parameters are `manager=all|unassigned|amo:<id>`, `channel=<normalized>` and
  `compare=previous|none` (SPEC M7.3), not the plan's `managerId`/boolean form.
- **RD3 — a manager asking for somebody else is refused.** SPEC M7.5 says a
  foreign manager key returns 403; the plan's illustrative test silently
  rewrote it to the session user. A shared link therefore either shows the same
  slice or fails loudly.
- **RD4 — no approved snapshot is `503 E_CONFIG_INCOMPLETE`** (SPEC M7.6), not
  the plan's 404: the screen is initial setup, not a missing object.
- **RD5 — drill-down is a page, not a modal.** A page keeps the slice in the
  URL, is shareable, needs no client-side focus trap, and works without
  JavaScript.
- **RD6 — component tests follow the repository's pattern**: pure functions plus
  `renderToStaticMarkup`, because Testing Library is not a dependency here.

## Task progress

- Task 1 (`18d662c`): dashboard filters, scope and response contracts.
  25 domain checks; five injected mutations all detected.
- Task 2 (`fa3ce41`): snapshot-pinned reads for overview, managers, channels and
  funnel plus four API routes. 11 database and 6 API integration checks; six
  mutations detected after a missing invariant (a pointer to a never-approved
  snapshot) got its own test.
- Task 3 (`413360c`): signed drill-down cursor, attention, lead card and CSV
  export. 11 cursor checks, 7 drill-down integration checks, 5 CSV contract
  checks, 6 more API checks; six mutations detected.
- Task 4 (`c5b9241`): dashboard shell, URL filters, four data states, freshness
  banner. 16 unit checks for the pure parts and static markup.
- Task 5 (`95ed84c`): overview, managers, channels, funnel, attention and
  drill-down views with shared formatters. 22 view checks.
- Task 6 (`ce3941c`): Playwright gate with seeded identities and one approved
  snapshot; 22 browser checks across roles, states, filters, accessibility and
  response budgets; `docs/runbooks/dashboard-access.md`.

## Plan 4 completion gate (live local Supabase)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:secrets` | passed |
| `pnpm test` | repo/worker 16/16; unit 483/483 |
| `pnpm test:contracts` | 24/24 |
| `pnpm test:integration` | 157/157 |
| `pnpm test:security` | 28/28 |
| `pnpm test:e2e` | 22/22 |
| `supabase db lint --fail-on error`, `git diff --check` | passed |

## Known interference (fixed on 2026-09-19)

Running the unit suite after the browser gate made the 16 database-backed
`oauth.test.ts` checks fail: the gate left its fixtures in the shared local
database, and the unit test's `delete from amo_connections` hit a foreign key
from the leftover pipeline configuration. A Playwright teardown project now
clears those fixtures after the dashboard suite, so suite order no longer
matters. Verified by running the complete gate in one sequence: unit 557/557,
contracts 24/24, integration 206/206, security 33/33, e2e 23/23.

## What Plan 4 does not include

- Nothing schedules normalization or snapshot building yet; the dashboard reads
  whatever approved snapshot exists.
- The quality and plans pages stay read-only; their write APIs are complete.
- Publication to Google Sheets belongs to Plan 5.
