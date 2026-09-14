import {
  closeDbClient,
  createServiceWorkerDbClient,
  purgeExpiredOAuthStates,
  type Database,
} from "@real2/db";
import { parseServerEnv, type ServerEnv } from "@real2/domain";
import { pathToFileURL } from "node:url";

export type WorkerIdleResult = Readonly<{
  status: "idle";
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
  if (switches.SYNC_ENABLED || switches.SHEET_PUBLISH_ENABLED) {
    throw new Error("Network integrations are not configured");
  }

  return { status: "idle", networkRequests: 0 };
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
