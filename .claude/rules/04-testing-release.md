# Rule: evidence before release

- Unit tests cover pure policy, date, money, channel, milestone, and metric logic.
- Integration tests cover PostgreSQL transactions/RLS and mock upstream behavior.
- Security tests prove forbidden network requests never leave the process and protected Sheet IDs never reach Google.
- E2E tests cover admin, head, manager, loading, error, empty, stale, drill-down, and URL filters.
- A failed or partial sync cannot change `current_snapshot_id`.
- Production switches remain false through migrations and deployments.
- No release before shadow reconciliation, restore rehearsal, runbooks, and explicit owner approval.
