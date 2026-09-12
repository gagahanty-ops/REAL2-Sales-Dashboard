import type { ServerEnv } from "@real2/domain";

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
