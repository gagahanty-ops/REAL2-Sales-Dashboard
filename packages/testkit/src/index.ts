export { createLogCapture, type LogCapture } from "./log-capture.js";
export {
  createAmoMockServer,
  type AmoMockRequest,
  type AmoMockServer,
} from "./amo-server.js";
export { syntheticAmoFixtures } from "./amo-fixtures.js";
export {
  findForbiddenPatterns,
  listTypeScriptFiles,
  type SourceViolation,
} from "./source-scan.js";
export {
  SYNTHETIC_APPLICATION_STATUS_ID,
  SYNTHETIC_CONFIG_ID,
  SYNTHETIC_INITIAL_RULES,
  SYNTHETIC_LEAD_ACCOUNT_ID,
  SYNTHETIC_OPEN_STATUS_ID,
  SYNTHETIC_PIPELINE_ID,
  SYNTHETIC_SOURCE_FIELD_ID,
  SYNTHETIC_WON_STATUS_ID,
  buildChannelRule,
  buildNormalizeLeadContext,
  buildRawLead,
  type RawLeadOverrides,
} from "./lead-builders.js";
export {
  GOLDEN_DAILY_RANGE,
  GOLDEN_RANGE,
  goldenLeadFacts,
} from "./golden/real2-golden.js";
export {
  goldenChannelRows,
  goldenDailyRows,
  goldenManagerRows,
  goldenMonthTotals,
} from "./golden/real2-golden.expected.js";
export {
  GOLDEN_ACCOUNT_ID,
  GOLDEN_APPLICATION_STATUS_ID,
  GOLDEN_CHANNEL_RULES,
  GOLDEN_OPEN_STATUS_ID,
  GOLDEN_PIPELINE_ID,
  GOLDEN_SOURCE_FIELD_ID,
  GOLDEN_SUBDOMAIN,
  GOLDEN_WON_STATUS_ID,
  goldenRawEvents,
  goldenRawLeads,
  goldenRawStatuses,
  goldenRawUsers,
  goldenRepeatedEvents,
  type GoldenRawEvent,
  type GoldenRawObject,
} from "./golden/real2-golden-raw.js";
export {
  metricContractEvidence,
  type MetricContractEvidence,
} from "./golden/metric-contract-evidence.js";
