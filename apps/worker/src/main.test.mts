import assert from "node:assert/strict";
import test from "node:test";

import { runWorkerCli, runWorkerOnce } from "./main.ts";

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

test("worker CLI validates disabled switches and emits a safe one-shot result", async () => {
  const lines: string[] = [];

  await runWorkerCli(
    {
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://postgres:postgres@db:5432/postgres",
      SUPABASE_URL: "http://supabase:54321",
      SUPABASE_ANON_KEY: "local-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
      AMO_CLIENT_ID: "synthetic-client-id",
      AMO_CLIENT_SECRET: "synthetic-client-secret",
      AMO_REDIRECT_URI:
        "https://dashboard.example.invalid/api/integrations/amo/callback",
      TOKEN_ENCRYPTION_KEY:
        "bG9jYWwtc3ludGhldGljLWVuY3J5cHRpb24ta2V5ISE=",
      SYNC_ENABLED: "false",
      SHEET_PUBLISH_ENABLED: "false",
    },
    (line) => lines.push(line),
  );

  assert.deepEqual(lines.map((line) => JSON.parse(line)), [
    { status: "idle", networkRequests: 0 },
  ]);
});
