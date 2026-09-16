import {
  closeDbClient,
  createRetentionWorkerDbClient,
  createServiceWorkerDbClient,
  deleteProvenRawBefore,
  failStaleSyncRuns,
  purgeExpiredOAuthStates,
  type Database,
  type SyncKind,
} from "@real2/db";
import { parseServerEnv, type ServerEnv } from "@real2/domain";
import { pathToFileURL } from "node:url";

export type WorkerIdleResult = Readonly<{
  status: "idle" | "ready";
  networkRequests: 0;
}>;

export type WorkerNetworkSwitches = Readonly<
  Pick<ServerEnv, "SYNC_ENABLED" | "SHEET_PUBLISH_ENABLED">
>;

export type WorkerRuntimeEnv = ServerEnv &
  Readonly<{
    WORKER_DATABASE_URL: string;
    RETENTION_DATABASE_URL: string;
  }>;

export type WorkerIterationState = {
  lastDispatchAt: Date | null;
};

const disabledNetworkSwitches: WorkerNetworkSwitches = {
  SYNC_ENABLED: false,
  SHEET_PUBLISH_ENABLED: false,
};

const FIVE_MINUTES_MS = 5 * 60_000;
const MOSCOW_OFFSET_MS = 3 * 60 * 60_000;
const RAW_RETENTION_MS = 90 * 24 * 60 * 60_000;

function fiveMinuteSlot(value: Date): number {
  return Math.floor(value.getTime() / FIVE_MINUTES_MS);
}

function moscowParts(value: Date): { date: string; hour: number; minute: number } {
  const shifted = new Date(value.getTime() + MOSCOW_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function dueWorkerSyncKinds(
  now: Date,
  lastDispatchAt: Date | null,
): readonly Extract<SyncKind, "incremental" | "nightly_reconciliation">[] {
  const due: Extract<SyncKind, "incremental" | "nightly_reconciliation">[] = [];
  if (
    now.getUTCMinutes() % 5 === 0 &&
    (!lastDispatchAt || fiveMinuteSlot(lastDispatchAt) < fiveMinuteSlot(now))
  ) {
    due.push("incremental");
  }

  const moscowNow = moscowParts(now);
  const moscowPrevious = lastDispatchAt ? moscowParts(lastDispatchAt) : null;
  if (
    moscowNow.hour === 2 &&
    moscowNow.minute === 30 &&
    (!moscowPrevious ||
      moscowPrevious.date !== moscowNow.date ||
      moscowPrevious.hour < 2 ||
      (moscowPrevious.hour === 2 && moscowPrevious.minute < 30))
  ) {
    due.push("nightly_reconciliation");
  }
  return due;
}

function requiredRestrictedUrl(
  input: Record<string, string | undefined>,
  key: "WORKER_DATABASE_URL" | "RETENTION_DATABASE_URL",
  expectedUsername: "service_worker" | "retention_worker",
): string {
  const value = input[key];
  if (!value) throw new Error(`${key} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  if (parsed.username !== expectedUsername) {
    throw new Error(`${key} must authenticate as ${expectedUsername}`);
  }
  return value;
}

export function parseWorkerRuntimeEnv(
  input: Record<string, string | undefined>,
): WorkerRuntimeEnv {
  const server = parseServerEnv(input);
  const workerUrl = requiredRestrictedUrl(
    input,
    "WORKER_DATABASE_URL",
    "service_worker",
  );
  const retentionUrl = requiredRestrictedUrl(
    input,
    "RETENTION_DATABASE_URL",
    "retention_worker",
  );
  if (new URL(workerUrl).username === new URL(retentionUrl).username || workerUrl === retentionUrl) {
    throw new Error("RETENTION_DATABASE_URL must be distinct from WORKER_DATABASE_URL");
  }
  return {
    ...server,
    WORKER_DATABASE_URL: workerUrl,
    RETENTION_DATABASE_URL: retentionUrl,
  };
}

export type WorkerCliDependencies = Readonly<{
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  createWorkerDbClient(databaseUrl: string): Database;
  createRetentionDbClient(databaseUrl: string): Database;
  purgeExpiredOAuthStates(db: Database): Promise<number>;
  failStaleSyncRuns(db: Database, cutoff: Date, finishedAt: Date): Promise<readonly string[]>;
  deleteProvenRawBefore(db: Database, cutoff: Date): Promise<{
    objectsDeleted: number;
    eventsDeleted: number;
    quarantineDeleted: number;
    hashesPreserved: number;
    normalizedRowsVerified: number;
  }>;
  runRawRetention(
    repository: Readonly<{ deleteProvenBefore(cutoff: Date): Promise<{
      objectsDeleted: number;
      eventsDeleted: number;
      quarantineDeleted: number;
      hashesPreserved: number;
      normalizedRowsVerified: number;
    }> }>,
    now: Date,
  ): Promise<unknown>;
  runSync(kind: SyncKind): Promise<void>;
  processSyncQueue(db: Database): Promise<number>;
  closeDbClient(db: Database): Promise<void>;
}>;

const workerCliDependencies: WorkerCliDependencies = {
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  createWorkerDbClient: createServiceWorkerDbClient,
  createRetentionDbClient: createRetentionWorkerDbClient,
  purgeExpiredOAuthStates,
  failStaleSyncRuns,
  deleteProvenRawBefore,
  async runRawRetention(repository, now) {
    const cutoff = new Date(now.getTime() - RAW_RETENTION_MS);
    const result = await repository.deleteProvenBefore(cutoff);
    const deleted =
      result.objectsDeleted + result.eventsDeleted + result.quarantineDeleted;
    if (
      deleted !== result.hashesPreserved ||
      deleted !== result.normalizedRowsVerified
    ) {
      throw new Error("raw retention proof counts do not match");
    }
    return { ...result, deleted };
  },
  runSync: async (kind) => {
    const { runSync } = await import("@real2/worker/amo-sync");
    await runSync(kind);
  },
  processSyncQueue: async (db) => {
    const { processSyncWorkQueue, runSync } = await import("@real2/worker/amo-sync");
    const { claimNextSyncWork, completeSyncWork } = await import("@real2/db");
    return processSyncWorkQueue({
      now: () => new Date(),
      claim: (input) => claimNextSyncWork(db, input),
      complete: (input) => completeSyncWork(db, input),
      run: runSync,
    });
  },
  closeDbClient,
};

export async function runWorkerOnce(
  switches: WorkerNetworkSwitches = disabledNetworkSwitches,
): Promise<WorkerIdleResult> {
  return { status: switches.SYNC_ENABLED ? "ready" : "idle", networkRequests: 0 };
}

export async function runWorkerIteration(
  env: WorkerRuntimeEnv,
  state: WorkerIterationState,
  dependencies: Partial<WorkerCliDependencies> = {},
): Promise<WorkerIdleResult> {
  const deps = { ...workerCliDependencies, ...dependencies };
  const now = deps.now();
  const workerDb = deps.createWorkerDbClient(env.WORKER_DATABASE_URL);
  const retentionDb = deps.createRetentionDbClient(env.RETENTION_DATABASE_URL);

  try {
    await deps.purgeExpiredOAuthStates(workerDb);
    await deps.failStaleSyncRuns(
      workerDb,
      new Date(now.getTime() - 20 * 60_000),
      now,
    );
    await deps.runRawRetention({
      deleteProvenBefore: (cutoff) =>
        deps.deleteProvenRawBefore(retentionDb, cutoff),
    }, now);

    if (env.SYNC_ENABLED) {
      const dispatched = dueWorkerSyncKinds(now, state.lastDispatchAt);
      for (const kind of dispatched) await deps.runSync(kind);
      if (dispatched.length > 0) state.lastDispatchAt = now;
      await deps.processSyncQueue(workerDb);
    }

    return runWorkerOnce(env);
  } finally {
    await deps.closeDbClient(retentionDb);
    await deps.closeDbClient(workerDb);
  }
}

export async function runWorkerCli(
  input: Record<string, string | undefined>,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  dependencies: Partial<WorkerCliDependencies> = {},
  options: Readonly<{ maxIterations?: number; pollIntervalMs?: number }> = {},
): Promise<void> {
  const env = parseWorkerRuntimeEnv(input);
  const state: WorkerIterationState = { lastDispatchAt: null };
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const deps = { ...workerCliDependencies, ...dependencies };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const result = await runWorkerIteration(env, state, deps);
    write(JSON.stringify(result));
    if (iteration + 1 < maxIterations) {
      await deps.sleep(pollIntervalMs);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runWorkerCli(process.env).catch(() => {
    process.stderr.write("Worker failed safely\n");
    process.exitCode = 1;
  });
}
