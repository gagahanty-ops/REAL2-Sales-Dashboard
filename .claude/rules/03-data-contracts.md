# Rule: deterministic data contracts

- Store source timestamps in UTC and compute business dates in `Europe/Moscow`.
- `report_date = created_date`; milestone timestamps remain audit fields.
- Use decimal/numeric money, never floating-point arithmetic.
- Deduplicate with stable amoCRM account/object/event keys.
- Preserve raw unknown values and emit quality issues; never guess or silently exclude.
- Build a candidate immutable snapshot, run quality gates, then atomically point to it only when approved.
- Dashboard queries, CSV, and Sheet publication read one snapshot version per response or operation.
