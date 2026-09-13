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
): Promise<void> {
  const env = parseServerEnv(input);
  const result = await runWorkerOnce(env);
  write(JSON.stringify(result));
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
