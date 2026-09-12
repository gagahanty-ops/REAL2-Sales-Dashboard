---
name: real2-metric-contract
description: Use before implementing or changing REAL2 metrics, dates, manager/channel attribution, snapshots, or report exports.
---

# REAL2 Metric Contract

1. Read the complete `METRICS_CATALOG.md`.
2. Identify the exact metric keys and dimensions affected.
3. Add or extend a golden fixture with explicit created, application, won, amount, manager, and channel values.
4. Assert `report_date` from `created_at` in `Europe/Moscow`, including a near-midnight case.
5. Assert repeated events and repeated syncs do not change totals.
6. Assert unknown values remain visible in quality counters.
7. Assert API, dashboard drill-down, CSV, and Sheet payload use the same snapshot and totals.
8. Run focused golden tests and `pnpm test:contracts`.

Never update expected totals merely to match new output. Explain and approve any metric-definition change in the catalog first.
