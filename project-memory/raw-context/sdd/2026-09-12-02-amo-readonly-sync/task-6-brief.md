### Task 6: Implement complete pagination, retries, overlap, and reconciliation

**Files:**
- Create: `apps/worker/src/jobs/amo-sync.ts`
- Create: `apps/worker/src/jobs/amo-sync.test.ts`
- Create: `apps/worker/src/schedule.ts`
- Create: `apps/worker/src/jobs/raw-retention.ts`
- Create: `apps/worker/src/jobs/sync-watchdog.ts`
- Create: `apps/web/src/app/api/sync-runs/route.ts`
- Create: `apps/web/src/app/api/sync-runs/[id]/route.ts`
- Create: `apps/web/src/app/sync/page.tsx`
- Create: `apps/web/src/app/sync/[id]/page.tsx`
- Create: `packages/testkit/src/amo-server.ts`
- Create: `packages/testkit/src/amo-fixtures.ts`

**Interfaces:**
- Consumes: active connection/config, DB/env controls, guarded transport, raw repositories.
- Produces: `runSync(kind, clock): Promise<SyncRunResult>`, schedules every five minutes and 02:30 Moscow reconciliation, plus M4.3 endpoints.

- [ ] **Step 1: Write failing worker tests for disabled, complete, and partial runs**

```ts
it("does not acquire a token or call the network when either switch is false", async () => {
  const result = await runSyncHarness({ envEnabled: true, dbEnabled: false });
  expect(result.kind).toBe("disabled");
  expect(result.tokenReads).toBe(0);
  expect(result.server.requests).toHaveLength(0);
});

it("does not advance cursors when page three fails after five retries", async () => {
  const before = await cursors.snapshot();
  amoServer.failPage(3, 503, 5);
  await expect(runSync("incremental", fixedClock)).resolves.toMatchObject({ status: "partial" });
  expect(await cursors.snapshot()).toEqual(before);
});
```

- [ ] **Step 2: Run worker tests and verify `runSync` is missing**

Run: `pnpm vitest run apps/worker/src/jobs/amo-sync.test.ts`

Expected: FAIL on missing worker job.

- [ ] **Step 3: Implement ordered sync with advisory lock and deterministic retry**

```ts
export async function runSync(kind: SyncKind, clock: Clock): Promise<SyncRunResult> {
  if (!env.SYNC_ENABLED || !(await controls.isEnabled("sync_enabled"))) return { kind: "disabled" };
  return locks.withAdvisoryLock("amo-sync", async () => {
    const run = await syncRuns.start(kind, clock.now());
    try {
      await ingestMetadata(run);
      await ingestEvents(run, { overlapMinutes: kind === "incremental" ? 10 : 0 });
      await ingestLeads(run, { full: kind !== "incremental" });
      await syncRuns.finishSuccessAndAdvanceCursors(run.id);
      return { status: "success", runId: run.id };
    } catch (error) {
      return syncRuns.finishNonSuccess(run.id, classifySyncFailure(error));
    }
  });
}
```

Follow `_links.next` until absent; reject repeated page checksums. Retry 401 once after locked refresh. Retry 429/5xx after 1, 3, 9, 27, and 60 seconds plus injected jitter; tests use a fake clock.

`sync-watchdog` marks a `running` run failed after 20 minutes and relies on connection close to release its advisory lock. `raw-retention` deletes raw payload/quarantine rows older than 90 days only after verifying normalized rows and stored hashes exist; it never deletes normalized history. The manual HTTP trigger returns 409 before network when another run owns the lock and requires confirmation in UI when the prior run started less than one minute ago.

- [ ] **Step 4: Verify schedules, overlaps, loops, concurrent runs, and count-drop blocking**

Run: `pnpm vitest run apps/worker/src/jobs/amo-sync.test.ts && pnpm test:integration && pnpm test:security`

Expected: PASS; one concurrent run gets `E_SYNC_LOCKED`; pagination loop fails; a full-count drop above 5% is critical; watchdog closes a 20-minute run; retention preserves hashes/history; disabled paths produce zero network calls.

- [ ] **Step 5: Commit the synchronization worker and safe status screens**

```bash
git add apps/worker apps/web/src/app/api/sync-runs apps/web/src/app/sync packages/testkit
git commit -m "feat: sync amoCRM through guarded read-only worker"
```

