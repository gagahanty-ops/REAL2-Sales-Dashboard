import { AppError } from "@real2/domain";
import { describe, expect, it, vi } from "vitest";

import {
  runNormalizationPipeline,
  type NormalizationPipelineDeps,
  type PipelineRun,
} from "./sheet-publication";

const runs: readonly PipelineRun[] = [
  { syncRunId: "run-1", configId: "config-1" },
  { syncRunId: "run-2", configId: "config-1" },
];

function deps(overrides: Partial<NormalizationPipelineDeps> = {}): NormalizationPipelineDeps {
  let version = 40;
  return {
    listPendingRuns: async () => runs,
    normalizeRun: async () => undefined,
    buildSnapshot: async () => {
      version += 1;
      return { id: `snapshot-${version}`, version };
    },
    approveSnapshot: async () => undefined,
    ...overrides,
  };
}

describe("runNormalizationPipeline", () => {
  it("normalizes, builds and approves every pending run", async () => {
    const normalize = vi.fn(async () => undefined);

    const result = await runNormalizationPipeline(deps({ normalizeRun: normalize }));

    expect(normalize.mock.calls.map(([id]) => id)).toEqual(["run-1", "run-2"]);
    expect(result).toMatchObject({
      normalizedRuns: 2,
      snapshotsBuilt: 2,
      snapshotsApproved: 2,
      snapshotsBlocked: 0,
      published: 0,
    });
  });

  it("does not publish when publication is not configured", async () => {
    const result = await runNormalizationPipeline(deps());

    expect(result.published).toBe(0);
  });

  it("publishes every approved snapshot when publication is available", async () => {
    const publish = vi.fn(async () => undefined);

    const result = await runNormalizationPipeline(deps({ publish }));

    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.published).toBe(2);
  });

  it("never publishes a snapshot the quality gate blocked", async () => {
    const publish = vi.fn(async () => undefined);
    const onBlocked = vi.fn(async () => undefined);

    const result = await runNormalizationPipeline(
      deps({
        approveSnapshot: async (snapshotId) => {
          if (snapshotId === "snapshot-41") {
            throw new AppError("E_DATA_QUALITY_BLOCK", 409);
          }
        },
        publish,
        onBlocked,
      }),
    );

    expect(result).toMatchObject({ snapshotsApproved: 1, snapshotsBlocked: 1, published: 1 });
    expect(publish.mock.calls.map(([id]) => id)).toEqual(["snapshot-42"]);
    expect(onBlocked).toHaveBeenCalledWith("snapshot-41", "E_DATA_QUALITY_BLOCK");
  });

  it("does nothing at all when no run is pending", async () => {
    const publish = vi.fn(async () => undefined);

    const result = await runNormalizationPipeline(
      deps({ listPendingRuns: async () => [], publish }),
    );

    expect(publish).not.toHaveBeenCalled();
    expect(result).toEqual({
      normalizedRuns: 0,
      snapshotsBuilt: 0,
      snapshotsApproved: 0,
      snapshotsBlocked: 0,
      published: 0,
    });
  });

  it("reports an unexpected failure instead of swallowing it", async () => {
    await expect(
      runNormalizationPipeline(
        deps({
          buildSnapshot: async () => {
            throw new AppError("E_CONFLICT", 409);
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });
});
