import { expect, it, vi } from "vitest";

import { runSyncWatchdog } from "./sync-watchdog";

it("fails runs that have remained running for twenty minutes", async () => {
  const markStaleFailed = vi.fn(async () => ["run-stale"]);
  const now = new Date("2026-09-15T09:00:00.000Z");

  const result = await runSyncWatchdog({ markStaleFailed }, now);

  expect(markStaleFailed).toHaveBeenCalledWith(
    new Date("2026-09-15T08:40:00.000Z"),
    now,
  );
  expect(result).toEqual({ failedRunIds: ["run-stale"] });
});
