# Plan 3 Task 1 review

Reviewed commit range: `4c248cbf84f779a9e34915087111eeafb78de289..0f45cd7940f6abffccd656adaf31a36c42595866`.

## Verdicts

- **Spec/task compliance: CHANGES REQUIRED.** The seven tables, specified columns, composite history FKs, indexes, policies, exports, and requested positive integration scenarios match Task 1. However, the repository money contract conflicts with the plan's explicit decimal-string boundary, and the factories cannot accept the transaction connection required by M5.5 and the planned normalizer. The promised verification coverage is incomplete for duplicate-event rejection and negative normalized-table access.
- **Code quality/security: CHANGES REQUIRED.** Remove unnecessary history UPDATE privileges, make the repository contracts transaction-compatible and decimal-safe, and address nullable quality keys and unsafe bigint conversion. No critical or high-severity exploit was established.

## Findings, ordered by severity

All findings below are P2 (medium).

### 1. Restrict the worker to append privileges on event history

**Location:** `supabase/migrations/0010_normalized_leads.sql:227-229`.

The combined grant gives `service_worker` UPDATE on both `lead_stage_events` and `lead_responsible_events`. Both repository methods only INSERT with `ON CONFLICT DO NOTHING`; they never require UPDATE. Since migration 0008 makes this role BYPASSRLS, this grant permits the runtime worker to rewrite a historical event's status, responsible user, timestamp, or lead linkage. There is no history immutability trigger to stop it. This exceeds the minimum grants needed for Task 1 and weakens the durable event evidence used to derive milestones.

Read-only catalog verification returned `worker_update=true` for both tables and `worker_delete=false`. Split the grant: SELECT/INSERT on event histories, SELECT/INSERT/UPDATE only on the mutable normalized rows and quality issues. Add a test using the restricted worker login that an event UPDATE is denied.

### 2. Accept a transaction connection in both repository factories

**Locations:** `packages/db/src/leads.ts:85-87`; `packages/db/src/quality.ts:58`.

Both factories accept only `Database`, which aliases postgres.js `Sql`. `db.begin(...)` supplies `TransactionSql`, which is not assignable to `Sql`. Therefore a normalizer cannot construct either repository inside its transaction without a type assertion or changing these APIs. Constructing them with the outer pool instead executes their statements outside that transaction, so rolling back the normalizer would leave partial normalized state. This blocks the transaction boundary required by SPEC M5.5 and Plan 3 Task 3.

An in-memory TypeScript compilation of `createNormalizedLeadRepository(tx)` and `createQualityRepository(tx)` reproduced the errors: `TransactionSql<{}> is not assignable to ... Database` because it lacks pool-only members. Accept `Database | TransactionSql` (as existing DB helpers do), or a suitable shared query interface, and verify rollback across lead/history/milestone/issue writes.

### 3. Keep normalized money as a decimal string at the repository boundary

**Location:** `packages/db/src/leads.ts:35` (used at line 135).

`UpsertLeadInput.priceRub` requires `number | null`, whereas the plan explicitly says `parseAmoRubles` returns a decimal string with two digits and preserves decimal money through storage. The next normalization task consequently cannot pass its validated money value to this repository: a value such as `'100.25'` is rejected at compile time. Converting it back to a JavaScript number abandons that exact-money contract and allows non-finite numbers such as NaN through the TypeScript API.

The TypeScript probe confirmed `Type 'string' is not assignable to type 'number'`. Accept a validated decimal string (or the project's exact-money type) and bind it directly into `numeric(14,2)`. Cover exact cent values, boundaries, and rejection of invalid/non-finite input. This finding does not claim that every two-decimal number currently loses a cent; it concerns the explicit cross-layer contract and missing safe boundary.

### 4. Count account-level quality issues using a nullable key

**Locations:** `packages/db/src/quality.ts:42`; `packages/db/src/quality.ts:86-89`.

`open` and the table support `amoLeadId: null` for account-level issues, but `countOpen` reuses the non-nullable `NormalizedLeadKey`. TypeScript therefore rejects the corresponding query. If null reaches the implementation from JavaScript or a cast, `amo_lead_id = NULL` matches nothing and returns zero even when an open issue exists. This makes the repository's count unusable for one of its own supported issue scopes.

The TypeScript probe reproduced the null rejection, and a read-only PostgreSQL expression check confirmed null equality yields SQL NULL. Give the count input the same nullable lead key as `open`, and compare with `IS NOT DISTINCT FROM`. Test two opens with `(accountId, null, code)` and assert both the stable issue identity and count of one. The partial unique index itself correctly deduplicates NULL lead keys; this finding is about the repository query.

### 5. Reject unsafe bigint-to-number conversions

**Location:** `packages/db/src/quality.ts:48-49`.

The mapper converts PostgreSQL bigint strings using `Number(...)` without checking safe-integer bounds. Distinct legal bigint identities can consequently become the same JavaScript number, contradicting the composite identity contract and returning an issue under an altered lead/account ID. For example, the actual mapper returned `9007199254740992` for the row value `'9007199254740993'` in an isolated mocked-query probe. Existing identity/configuration helpers already reject unsafe conversions.

Preserve IDs as strings/bigints end to end or use a shared checked conversion and reject invalid values. Apply the same safe positive-integer boundary to the new numeric identity inputs, and test the boundary. This is a latent correctness defect for out-of-range IDs, not a claim that current amoCRM fixtures use such IDs.

## Compliance and security details

- **Composite ownership and FK correctness:** `leads` has UNIQUE `(account_id, amo_lead_id)`; stage history, responsible history, and milestones all reference that exact pair. Event uniqueness includes account. This prevents the cross-account history attachment described in the brief. Confirmed from both SQL and the local PostgreSQL constraint catalog.
- **Configuration and quality references:** the channel/config and sync-run FKs match the exact supplied schema. The task does not specify a quality-to-lead FK; issues may need to describe rejected/unmaterialized leads, so its absence is not treated as a defect. Config/account coherence and metadata existence are not additionally enforced by this migration; callers must validate them as subsequent normalization tasks require.
- **Issue dedupe:** the partial expression index and repository conflict target match. Only open issues conflict; resolved/accepted historical rows do not prevent a new open row. NULL lead keys coalesce to zero and dedupe correctly. The schema permits lead ID zero, which would collide with the NULL sentinel; positive identity validation or a database check should accompany the numeric boundary noted above.
- **RLS:** active admin/head read all seven tables. A manager reads assigned leads and related events/milestones through an account-and-lead-scoped EXISTS query. Metadata and quality issues are leadership-only. Active-state checks apply both to leadership role resolution and manager lookup. Unknown/inactive authenticated identities have no matching read branch. There are no normalized user-facing write grants or write policies. No raw joins/payloads were added.
- **Anonymous access:** all new tables revoke anon grants and have no anon policies. Local privilege checks confirmed no anon SELECT on the checked lead/history/quality tables.
- **Migration compatibility:** `extensions.citext` is provided by 0001, config references by 0004, sync references by 0005, and the worker role by 0002/0008. No version collision with 0001–0009 exists. The local migration ledger contains all versions 0001 through 0010, and the expected 0010 constraints/index are present. No reset or migration application was performed during review.
- **SQL safety:** all repository values use parameterized tagged templates; quality JSON uses `db.json`. No interpolated identifier or raw SQL execution was introduced in production repositories. Each individual upsert is atomic; cross-repository transaction compatibility is the separate issue above.

## Verification coverage and limitations

The implementation report records a successful reset, 83 integration tests, 23 security tests, lint, and typecheck. Those are author-reported results, not rerun-suite results from this review. Current tests cover cross-account stage FK rejection, ordinary open-issue dedupe, basic repository persistence, admin/head reads, and one manager's scoped reads.

The new tests do not explicitly exercise duplicate stage/responsible event rejection, nullable issue keys, resolved/accepted issue recurrence (the test named “reopens” never changes status), inactive/unknown/anon normalized access, user-facing normalized writes, restricted worker privilege bounds, rollback, decimal strings, or bigint bounds. These are targeted additions relevant to the findings and the brief's verification expectations.

Review verification was limited to source inspection, read-only local PostgreSQL catalog/expression queries, in-memory TypeScript contract checks, and a mocked-query execution of the bigint mapper. No database rows, roles, or schema were changed, no live external service was contacted, and no implementation files were edited. The only written file is this requested review report.

The default Node executable failed to load its `simdjson.31` dependency; the probes ran successfully with the installed Node 22 executable.

## Fix round 1 scoped re-review

Reviewed package: `review-0f45cd7..0ae530f.diff`, commit range `0f45cd7940f6abffccd656adaf31a36c42595866..0ae530f65a02059a4535f628fd19daf1fe15c70f`. Review inputs were limited to that package and this prior review, as requested.

**Spec/task compliance: APPROVED for Task 1. Code quality/security: APPROVED. All five reported P2 findings are closed in the revised source. No new blocking findings were identified in the scoped diff.**

1. **History privileges — closed.** The 0010 grant now limits stage/responsible history to SELECT/INSERT while preserving UPDATE for mutable tables. A new security test uses the restricted worker login and expects PostgreSQL `42501` for UPDATE on each history table. This corrects privileges on a fresh/reset application of migration 0010; changing an already-applied migration alone does not retroactively alter an existing database, so this approval does not certify the current live grants.
2. **Transaction compatibility — closed.** `NormalizedLeadDb = Database | TransactionSql` is accepted by both factories. The new integration test constructs both repositories with the same transaction connection, writes a lead and quality issue, throws, then asserts both writes rolled back. SQL operations continue to use the supplied connection.
3. **Decimal money — closed.** `priceRub` is now `string | null`; validation accepts canonical nonnegative two-decimal values with at most 12 integer digits, matching `numeric(14,2)`. The value is bound directly without conversion to a number. The added test checks exact round-trip storage of `999999999999.99` and rejects a malformed one-decimal value.
4. **Nullable quality keys — closed.** `QualityLeadKey` permits null and the SQL predicate uses `IS NOT DISTINCT FROM`. The regression test opens the same account-level issue twice, checks stable identity, and counts exactly one open issue.
5. **Bigint conversion and identity safety — closed.** The mapper checks positive safe-integer bounds before returning account/lead numbers. Both repositories validate their required and nullable identity inputs; this also prevents zero lead IDs from colliding with the NULL dedupe sentinel through these APIs. The added test rejects an account ID above the safe-integer limit. Direct coverage of the mapper's out-of-range return path remains a useful nonblocking addition.

The earlier coverage observations about duplicate-event rejection, inactive/unknown/anon normalized access, recurrence after resolution/acceptance, and user-facing writes remain test-hardening opportunities; the fix introduces no policy/key changes that suggest a new regression in those paths. The new rollback test covers lead and issue writes rather than every history/milestone method, but all methods share the same supplied transaction handle.

Verification for this re-review was static inspection of the complete 545-line fix package. Tests and database probes were not rerun, and no files beyond this requested report append were read or changed. No external actions were taken.
