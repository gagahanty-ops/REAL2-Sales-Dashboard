const WATCHDOG_TIMEOUT_MS = 20 * 60_000;

export type SyncWatchdogRepository = Readonly<{
  markStaleFailed(cutoff: Date, finishedAt: Date): Promise<readonly string[]>;
}>;

export async function runSyncWatchdog(
  repository: SyncWatchdogRepository,
  now = new Date(),
): Promise<Readonly<{ failedRunIds: readonly string[] }>> {
  const cutoff = new Date(now.getTime() - WATCHDOG_TIMEOUT_MS);
  return { failedRunIds: await repository.markStaleFailed(cutoff, now) };
}
