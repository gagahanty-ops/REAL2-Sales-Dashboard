import { AppError } from "@real2/domain";

export type PipelineRun = Readonly<{ syncRunId: string; configId: string }>;

export type PipelineSnapshot = Readonly<{ id: string; version: number }>;

export type NormalizationPipelineDeps = Readonly<{
  /** Successful sync runs that have no snapshot yet, oldest first. */
  listPendingRuns(): Promise<readonly PipelineRun[]>;
  normalizeRun(syncRunId: string): Promise<void>;
  buildSnapshot(run: PipelineRun): Promise<PipelineSnapshot>;
  approveSnapshot(snapshotId: string): Promise<void>;
  /** Present only when publication is configured and both switches are on. */
  publish?: ((snapshotId: string) => Promise<void>) | undefined;
  onBlocked?: ((snapshotId: string, code: string) => Promise<void>) | undefined;
}>;

export type NormalizationPipelineResult = Readonly<{
  normalizedRuns: number;
  snapshotsBuilt: number;
  snapshotsApproved: number;
  snapshotsBlocked: number;
  published: number;
}>;

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : "E_INTERNAL";
}

/**
 * The chain that turns finished synchronizations into a published report:
 * normalize the run, build its snapshot, approve it when the quality gate
 * allows, and publish only when publication is configured and enabled.
 *
 * Every step is independent: a snapshot blocked by data quality leaves the
 * previous current snapshot in place and never reaches publication, and one
 * failing run does not stop the others.
 */
export async function runNormalizationPipeline(
  deps: NormalizationPipelineDeps,
): Promise<NormalizationPipelineResult> {
  const pending = await deps.listPendingRuns();
  let normalizedRuns = 0;
  let snapshotsBuilt = 0;
  let snapshotsApproved = 0;
  let snapshotsBlocked = 0;
  let published = 0;

  for (const run of pending) {
    await deps.normalizeRun(run.syncRunId);
    normalizedRuns += 1;

    const snapshot = await deps.buildSnapshot(run);
    snapshotsBuilt += 1;

    try {
      await deps.approveSnapshot(snapshot.id);
      snapshotsApproved += 1;
    } catch (error) {
      snapshotsBlocked += 1;
      await deps.onBlocked?.(snapshot.id, errorCode(error));
      continue;
    }

    if (!deps.publish) continue;
    await deps.publish(snapshot.id);
    published += 1;
  }

  return {
    normalizedRuns,
    snapshotsBuilt,
    snapshotsApproved,
    snapshotsBlocked,
    published,
  };
}
