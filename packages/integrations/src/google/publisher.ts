import { AppError, readBackMatches, type SheetPayload } from "@real2/domain";

import { computeLayoutFingerprint } from "./layout.js";
import type { SheetClient } from "./policy.js";

export type PublishOutcome = Readonly<{
  cellsWritten: number;
  checksum: string;
}>;

export type PublishContext = Readonly<{
  client: SheetClient;
  payload: SheetPayload;
  /** Fingerprint recorded when the target was activated. */
  expectedFingerprint: string;
}>;

export type RetrySchedule = Readonly<{
  delaysSeconds: readonly number[];
  sleep(seconds: number): Promise<void>;
}>;

/** SPEC M9.5: 429 and 5xx are retried on this exact schedule. */
export const DEFAULT_RETRY_DELAYS: readonly number[] = [1, 3, 9, 27, 60];

function isRetryable(error: unknown): boolean {
  return (
    error instanceof AppError
    && error.code === "E_SHEET_UPSTREAM"
    && (error.status === 429 || error.status >= 500)
  );
}

/**
 * Writes one snapshot to the copy and proves it landed:
 *
 * 1. the copy's structure is read again and must still match the fingerprint
 *    recorded at activation, otherwise nothing is written at all;
 * 2. every mapped range goes out in a single batch, so a failure cannot leave
 *    half a report behind;
 * 3. the written ranges are read back and compared with the intended payload.
 *
 * Any mismatch is an error: the previous contents of the copy stay in place and
 * the caller decides what to disable.
 */
export async function publishPayload(context: PublishContext): Promise<PublishOutcome> {
  const metadata = await context.client.readMetadata();
  if (computeLayoutFingerprint(metadata) !== context.expectedFingerprint) {
    throw new AppError("E_SHEET_LAYOUT_MISMATCH", 409);
  }

  const written = await context.client.writeValues(
    context.payload.updates.map((update) => ({
      range: update.range,
      values: update.values,
    })),
  );

  const observed = await Promise.all(
    context.payload.updates.map(async (update) => ({
      range: update.range,
      values: await context.client.readValues(update.range),
    })),
  );
  if (!readBackMatches(context.payload, observed)) {
    throw new AppError("E_SHEET_UPSTREAM", 502, "Проверка записи не сошлась");
  }

  return {
    cellsWritten: written.updatedCells > 0 ? written.updatedCells : context.payload.cellCount,
    checksum: context.payload.checksum,
  };
}

/**
 * Runs an operation with the publication retry schedule. Only throttling and
 * upstream failures are retried; a layout mismatch or a checksum failure is a
 * decision, not a hiccup, and is raised immediately.
 */
export async function withPublicationRetries<T>(
  action: () => Promise<T>,
  schedule: RetrySchedule,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= schedule.delaysSeconds.length; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === schedule.delaysSeconds.length) break;
      await schedule.sleep(schedule.delaysSeconds[attempt] as number);
    }
  }
  throw lastError;
}

/** Maps any failure to the safe code stored with the publication attempt. */
export function classifyPublicationError(error: unknown): Readonly<{
  code: string;
  summary: string;
}> {
  if (error instanceof AppError) {
    return { code: error.code, summary: error.safeMessage };
  }
  return { code: "E_INTERNAL", summary: "Неизвестная ошибка публикации" };
}
