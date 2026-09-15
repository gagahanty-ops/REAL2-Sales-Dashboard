import { AppError } from "@real2/domain";

const RAW_RETENTION_MS = 90 * 24 * 60 * 60_000;

export type RawRetentionProofResult = Readonly<{
  objectsDeleted: number;
  eventsDeleted: number;
  quarantineDeleted: number;
  hashesPreserved: number;
  normalizedRowsVerified: number;
}>;

export type RawRetentionRepository = Readonly<{
  deleteProvenBefore(cutoff: Date): Promise<RawRetentionProofResult>;
}>;

export async function runRawRetention(
  repository: RawRetentionRepository,
  now = new Date(),
): Promise<RawRetentionProofResult & Readonly<{ deleted: number }>> {
  const cutoff = new Date(now.getTime() - RAW_RETENTION_MS);
  const result = await repository.deleteProvenBefore(cutoff);
  const deleted =
    result.objectsDeleted + result.eventsDeleted + result.quarantineDeleted;
  if (
    deleted !== result.hashesPreserved ||
    deleted !== result.normalizedRowsVerified
  ) {
    throw new AppError("E_DATA_QUALITY_BLOCK", 500);
  }
  return { ...result, deleted };
}
