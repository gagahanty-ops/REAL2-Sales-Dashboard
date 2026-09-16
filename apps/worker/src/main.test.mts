import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkerRuntimeEnv,
  runWorkerCli,
  runWorkerIteration,
  runWorkerOnce,
} from "./main.ts";

const baseEnv = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/postgres",
  WORKER_DATABASE_URL: "postgresql://service_worker:worker-secret@db:5432/postgres",
  RETENTION_DATABASE_URL: "postgresql://retention_worker:retention-secret@db:5432/postgres",
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
};

test("worker starts idle without contacting an external system", async () => {
  const result = await runWorkerOnce();

  assert.deepEqual(result, { status: "idle", networkRequests: 0 });
});

test("worker accepts enabled sync scheduling without a placeholder failure", async () => {
  assert.deepEqual(await runWorkerOnce({
    SYNC_ENABLED: true,
    SHEET_PUBLISH_ENABLED: false,
  }), { status: "ready", networkRequests: 0 });
});

test("worker CLI validates disabled switches and emits a safe one-shot result", async () => {
  const lines: string[] = [];
  const dependencies = {
    now: () => new Date("2026-09-14T23:30:00.000Z"),
    async sleep() {
      return undefined;
    },
    createWorkerDbClient() {
      return {};
    },
    createRetentionDbClient() {
      return {};
    },
    async purgeExpiredOAuthStates() {
      return 0;
    },
    async failStaleSyncRuns() {
      return [];
    },
    async deleteProvenRawBefore() {
      return {
        objectsDeleted: 0,
        eventsDeleted: 0,
        quarantineDeleted: 0,
        hashesPreserved: 0,
        normalizedRowsVerified: 0,
      };
    },
    async runRawRetention() {
      return undefined;
    },
    async runSync() {
      return undefined;
    },
    async processSyncQueue() {
      return 0;
    },
    async closeDbClient() {
      return undefined;
    },
  };

  await runWorkerCli(
    baseEnv,
    (line) => lines.push(line),
    dependencies,
    { maxIterations: 1 },
  );

  assert.deepEqual(lines.map((line) => JSON.parse(line)), [
    { status: "idle", networkRequests: 0 },
  ]);
});

test("worker CLI runs OAuth-state retention with its scoped database client", async () => {
  const calls: string[] = [];

  await runWorkerCli(
    baseEnv,
    () => undefined,
    {
      now: () => new Date("2026-09-14T23:30:00.000Z"),
      async sleep() {
        return undefined;
      },
      createWorkerDbClient() {
        calls.push("create-worker");
        return { name: "worker" };
      },
      createRetentionDbClient() {
        calls.push("create-retention");
        return { name: "retention" };
      },
      async purgeExpiredOAuthStates(db) {
        calls.push(`purge-${db.name}`);
        return 1;
      },
      async failStaleSyncRuns(db) {
        calls.push(`watchdog-${db.name}`);
        return [];
      },
      async deleteProvenRawBefore(db) {
        calls.push(`retention-delete-${db.name}`);
        return {
          objectsDeleted: 0,
          eventsDeleted: 0,
          quarantineDeleted: 0,
          hashesPreserved: 0,
          normalizedRowsVerified: 0,
        };
      },
      async runRawRetention(repository) {
        calls.push("retention-job");
        await repository.deleteProvenBefore(new Date("2026-06-16T23:30:00.000Z"));
      },
      async runSync() {
        return undefined;
      },
      async processSyncQueue() {
        return 0;
      },
      async closeDbClient(db) {
        calls.push(`close-${db.name}`);
      },
    },
    { maxIterations: 1 },
  );

  assert.deepEqual(calls, [
    "create-worker",
    "create-retention",
    "purge-worker",
    "watchdog-worker",
    "retention-job",
    "retention-delete-retention",
    "close-retention",
    "close-worker",
  ]);
});

test("worker runtime rejects postgres, admin, or shared worker credentials", () => {
  assert.throws(
    () => parseWorkerRuntimeEnv({ ...baseEnv, WORKER_DATABASE_URL: baseEnv.DATABASE_URL }),
    /WORKER_DATABASE_URL/,
  );
  assert.throws(
    () => parseWorkerRuntimeEnv({
      ...baseEnv,
      RETENTION_DATABASE_URL: baseEnv.WORKER_DATABASE_URL,
    }),
    /RETENTION_DATABASE_URL/,
  );
  assert.throws(
    () => parseWorkerRuntimeEnv({
      ...baseEnv,
      RETENTION_DATABASE_URL:
        "postgresql://postgres:postgres@db:5432/postgres",
    }),
    /RETENTION_DATABASE_URL/,
  );
});

test("worker iteration runs watchdog and retention even when sync is disabled", async () => {
  const calls: string[] = [];
  const workerDb = { name: "worker" };
  const retentionDb = { name: "retention" };
  const state = { lastDispatchAt: null as Date | null };

  await runWorkerIteration(
    parseWorkerRuntimeEnv(baseEnv),
    state,
    {
      now: () => new Date("2026-09-14T23:30:00.000Z"),
      createWorkerDbClient(url) {
        calls.push(`worker:${new URL(url).username}`);
        return workerDb;
      },
      createRetentionDbClient(url) {
        calls.push(`retention:${new URL(url).username}`);
        return retentionDb;
      },
      async purgeExpiredOAuthStates(db) {
        calls.push(`purge:${db.name}`);
        return 0;
      },
      async failStaleSyncRuns(db) {
        calls.push(`watchdog:${db.name}`);
        return [];
      },
      async runRawRetention(repository) {
        calls.push("retention-job");
        await repository.deleteProvenBefore(new Date("2026-06-16T23:30:00.000Z"));
      },
      async deleteProvenRawBefore(db) {
        calls.push(`retention-delete:${db.name}`);
        return {
          objectsDeleted: 0,
          eventsDeleted: 0,
          quarantineDeleted: 0,
          hashesPreserved: 0,
          normalizedRowsVerified: 0,
        };
      },
      async runSync(kind) {
        calls.push(`sync:${kind}`);
      },
      async processSyncQueue() {
        calls.push("queue");
        return 0;
      },
      async closeDbClient(db) {
        calls.push(`close:${db.name}`);
      },
    },
  );

  assert.deepEqual(calls, [
    "worker:service_worker",
    "retention:retention_worker",
    "purge:worker",
    "watchdog:worker",
    "retention-job",
    "retention-delete:retention",
    "close:retention",
    "close:worker",
  ]);
  assert.equal(state.lastDispatchAt, null);
});

test("worker iteration dispatches five-minute sync, nightly Moscow sync, and queue work when enabled", async () => {
  const calls: string[] = [];
  const db = { name: "db" };
  const state = { lastDispatchAt: null as Date | null };
  const enabledEnv = parseWorkerRuntimeEnv({ ...baseEnv, SYNC_ENABLED: "true" });

  await runWorkerIteration(
    enabledEnv,
    state,
    {
      now: () => new Date("2026-09-14T23:30:00.000Z"),
      createWorkerDbClient() {
        return db;
      },
      createRetentionDbClient() {
        return db;
      },
      async purgeExpiredOAuthStates() {
        return 0;
      },
      async failStaleSyncRuns() {
        calls.push("watchdog");
        return [];
      },
      async runRawRetention() {
        calls.push("retention");
      },
      async deleteProvenRawBefore() {
        throw new Error("runRawRetention was stubbed");
      },
      async runSync(kind) {
        calls.push(`sync:${kind}`);
      },
      async processSyncQueue() {
        calls.push("queue");
        return 1;
      },
      async closeDbClient() {
        return undefined;
      },
    },
  );

  assert.deepEqual(calls, [
    "watchdog",
    "retention",
    "sync:incremental",
    "sync:nightly_reconciliation",
    "queue",
  ]);
  assert.deepEqual(state.lastDispatchAt, new Date("2026-09-14T23:30:00.000Z"));
});
