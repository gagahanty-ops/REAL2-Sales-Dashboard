import assert from "node:assert/strict";
import test from "node:test";

import { runWorkerOnce } from "./main.ts";

test("worker starts idle without contacting an external system", async () => {
  const result = await runWorkerOnce();

  assert.deepEqual(result, { status: "idle", networkRequests: 0 });
});

test("worker refuses enabled network switches before integrations are configured", async () => {
  await assert.rejects(
    () =>
      runWorkerOnce({
        SYNC_ENABLED: true,
        SHEET_PUBLISH_ENABLED: false,
      }),
    /Network integrations are not configured/,
  );
});
