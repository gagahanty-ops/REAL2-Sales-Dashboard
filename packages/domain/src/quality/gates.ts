import { AppError } from "../errors.js";
import {
  QUALITY_CODES,
  QUALITY_CODE_POLICY,
  isQualityCode,
  qualityCounterKey,
  type QualityCode,
  type QualityCounterKey,
} from "./codes.js";

export type QualitySummary = Readonly<Record<string, number>>;

export type QualityGateResult = Readonly<{
  approved: boolean;
  /** Counter keys that block publication, in the sorted catalogue order. */
  blockingCodes: readonly QualityCounterKey[];
}>;

export type QualityGateOptions = Readonly<{
  /** Codes with an accepted exception; only an acceptable code is lifted. */
  acceptedCodes?: readonly string[];
}>;

export function emptyQualitySummary(): Record<QualityCounterKey, number> {
  const summary = {} as Record<QualityCounterKey, number>;
  for (const code of QUALITY_CODES) summary[qualityCounterKey(code)] = 0;
  return summary;
}

function countOf(summary: QualitySummary, code: QualityCode): number {
  const value = summary[qualityCounterKey(code)] ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError("E_VALIDATION", 422);
  return value;
}

/**
 * Decides whether a snapshot may be published. Only codes marked `blocks` stop
 * publication, and an accepted exception lifts the block only for a code the
 * policy marks `acceptable` (SPEC M5.3).
 */
export function evaluateQualityGate(
  summary: QualitySummary,
  options: QualityGateOptions = {},
): QualityGateResult {
  for (const key of Object.keys(summary)) {
    const code = key.replace(/_count$/, "");
    if (!key.endsWith("_count") || !isQualityCode(code)) {
      throw new AppError("E_VALIDATION", 422);
    }
  }

  const accepted = new Set(options.acceptedCodes ?? []);
  const blockingCodes: QualityCounterKey[] = [];
  for (const code of QUALITY_CODES) {
    const policy = QUALITY_CODE_POLICY[code];
    const count = countOf(summary, code);
    if (!policy.blocks || count === 0) continue;
    if (policy.acceptable && accepted.has(code)) continue;
    blockingCodes.push(qualityCounterKey(code));
  }

  return { approved: blockingCodes.length === 0, blockingCodes };
}
