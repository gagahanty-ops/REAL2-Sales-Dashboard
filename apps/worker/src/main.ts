export type WorkerIdleResult = Readonly<{
  status: "idle";
  networkRequests: 0;
}>;

export async function runWorkerOnce(): Promise<WorkerIdleResult> {
  return { status: "idle", networkRequests: 0 };
}
