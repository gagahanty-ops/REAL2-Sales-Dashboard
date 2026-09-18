import { HISTORY_ISSUE_SEVERITY } from "../leads/build-history.js";
import {
  LEAD_ISSUE_SEVERITY,
  type LeadQualitySeverity,
} from "../leads/normalize-lead.js";

export type QualityCodePolicy = Readonly<{
  severity: LeadQualitySeverity;
  /** A blocking code stops production publication (METRICS_CATALOG section 12). */
  blocks: boolean;
  /** Whether an admin may accept the exception (SPEC M5.3). */
  acceptable: boolean;
}>;

/**
 * The single policy table for data-quality codes. It unions the snapshot codes
 * of `LEAD_ISSUE_SEVERITY`, the timeline codes of `HISTORY_ISSUE_SEVERITY` and
 * the operational codes of `METRICS_CATALOG.md` section 11. `blocks` always
 * follows the severity; `acceptable` is the separate administrative decision.
 *
 * `missing_stage_history` is deliberately not acceptable: SPEC M5.3 forbids
 * accepting it, which overrides the plan's illustrative pseudocode.
 */
export const QUALITY_CODE_POLICY = {
  account_mismatch: { severity: "blocking", blocks: true, acceptable: false },
  channel_rule_conflict: { severity: "warning", blocks: false, acceptable: true },
  duplicate_event: { severity: "info", blocks: false, acceptable: false },
  invalid_created_at: { severity: "blocking", blocks: true, acceptable: false },
  invalid_event_time: { severity: "blocking", blocks: true, acceptable: false },
  invalid_price: { severity: "warning", blocks: false, acceptable: true },
  invalid_updated_at: { severity: "blocking", blocks: true, acceptable: false },
  malformed_event_payload: { severity: "warning", blocks: false, acceptable: true },
  malformed_lead: { severity: "blocking", blocks: true, acceptable: false },
  missing_responsible: { severity: "warning", blocks: false, acceptable: true },
  missing_stage_history: { severity: "blocking", blocks: true, acceptable: false },
  out_of_scope_pipeline: { severity: "warning", blocks: false, acceptable: true },
  source_api_error: { severity: "blocking", blocks: true, acceptable: false },
  stage_history_conflict: { severity: "warning", blocks: false, acceptable: true },
  stale_lead: { severity: "warning", blocks: false, acceptable: true },
  unknown_channel: { severity: "warning", blocks: false, acceptable: true },
  unknown_current_status: { severity: "blocking", blocks: true, acceptable: false },
  won_without_valid_price: { severity: "blocking", blocks: true, acceptable: true },
} as const satisfies Record<string, QualityCodePolicy>;

export type QualityCode = keyof typeof QUALITY_CODE_POLICY;
export type QualityCounterKey = `${QualityCode}_count`;

export const QUALITY_CODES = Object.keys(QUALITY_CODE_POLICY).sort() as readonly
  QualityCode[];

/** Compile-time proof that both source catalogues are covered by the policy. */
type MissingSnapshotCode = Exclude<keyof typeof LEAD_ISSUE_SEVERITY, QualityCode>;
type MissingHistoryCode = Exclude<keyof typeof HISTORY_ISSUE_SEVERITY, QualityCode>;
const _snapshotCodesCovered: MissingSnapshotCode extends never ? true : never = true;
const _historyCodesCovered: MissingHistoryCode extends never ? true : never = true;
void _snapshotCodesCovered;
void _historyCodesCovered;

export function isQualityCode(value: string): value is QualityCode {
  return Object.hasOwn(QUALITY_CODE_POLICY, value);
}

export function qualityCounterKey(code: QualityCode): QualityCounterKey {
  return `${code}_count`;
}

/** An unknown code is never acceptable: policy is explicit, never inferred. */
export function isAcceptableQualityCode(value: string): boolean {
  return isQualityCode(value) && QUALITY_CODE_POLICY[value].acceptable;
}

export function qualityCodeBlocks(value: string): boolean {
  return isQualityCode(value) && QUALITY_CODE_POLICY[value].blocks;
}
