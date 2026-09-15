import {
  closeDbClient,
  createServiceWorkerDbClient,
  failStaleSyncRuns,
  purgeExpiredOAuthStates,
  type Database,
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

const disabledNetworkSwitches: WorkerNetworkSwitches = {
  SYNC_ENABLED: false,
  SHEET_PUBLISH_ENABLED: false,
};

export type WorkerCliDependencies = Readonly<{
  createWorkerDbClient(databaseUrl: string): Database;
  purgeExpiredOAuthStates(db: Database): Promise<number>;
  closeDbClient(db: Database): Promise<void>;
}>;

const workerCliDependencies: WorkerCliDependencies = {
  createWorkerDbClient: createServiceWorkerDbClient,
  purgeExpiredOAuthStates,
  closeDbClient,
};

export async function runWorkerOnce(
  switches: WorkerNetworkSwitches = disabledNetworkSwitches,
): Promise<WorkerIdleResult> {
  return { status: switches.SYNC_ENABLED ? "ready" : "idle", networkRequests: 0 };
}

export async function runWorkerCli(
  input: Record<string, string | undefined>,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  dependencies: WorkerCliDependencies = workerCliDependencies,
): Promise<void> {
  const env = parseServerEnv(input);
  const db = dependencies.createWorkerDbClient(env.DATABASE_URL);

  try {
    await dependencies.purgeExpiredOAuthStates(db);
    // The one-shot entrypoint is cron-friendly. Scheduled sync calls retain
    // the double switch inside runSync; watchdog is DB-only and safe while
    // sync is disabled.
    if (env.SYNC_ENABLED) {
      await failStaleSyncRuns(db, new Date(Date.now() - 20 * 60_000), new Date());
      const now = new Date();
      if (now.getUTCMinutes() % 5 === 0) {
        // Resolve only in an enabled production worker. Node's repository-test
        // runner executes TypeScript source directly, while deployed workers
        // use the package's compiled guarded entrypoint.
        const { runSync } = await import("@real2/worker/amo-sync");
        await runSync("incremental");
      }
    }
    const result = await runWorkerOnce(env);
    write(JSON.stringify(result));
  } finally {
    await dependencies.closeDbClient(db);
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
