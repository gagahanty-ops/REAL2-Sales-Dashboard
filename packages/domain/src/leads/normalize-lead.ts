import { z } from "zod";

import {
  channelMatchTypeSchema,
  normalizedChannelSchema,
} from "../amo/config.js";
import { AppError } from "../errors.js";
import { isZeroRubles, parseAmoRubles, type Rubles } from "../money/rubles.js";
import {
  parseIsoInstant,
  toMoscowDate,
  unixSecondsToInstant,
} from "../time/moscow-date.js";
import {
  extractChannelInput,
  matchChannel,
  type ChannelMatch,
  type ChannelRule,
  type NormalizedChannel,
} from "./channel.js";

/** Confirmed amoCRM account host (SPEC M2.5). */
const AMO_LEAD_URL_PREFIX = "https://555151.amocrm.ru/leads/detail/";

export type LeadQualitySeverity = "info" | "warning" | "blocking";

/**
 * Lead-level issue candidates produced by snapshot normalization. Task 4 owns
 * the final acceptance policy; these severities are the normalization default.
 */
export const LEAD_ISSUE_SEVERITY = {
  account_mismatch: "blocking",
  channel_rule_conflict: "warning",
  invalid_created_at: "blocking",
  invalid_price: "warning",
  invalid_updated_at: "blocking",
  malformed_lead: "blocking",
  missing_responsible: "warning",
  out_of_scope_pipeline: "warning",
  unknown_channel: "warning",
  unknown_current_status: "blocking",
  won_without_valid_price: "blocking",
} as const satisfies Record<string, LeadQualitySeverity>;

export type LeadQualityCode = keyof typeof LEAD_ISSUE_SEVERITY;

/** Only fixed reason codes and numeric IDs; never names or source text. */
type SafeDetails = Readonly<Record<string, string | number>>;

export type LeadQualityIssueCandidate = Readonly<{
  accountId: number;
  amoLeadId: number | null;
  code: LeadQualityCode;
  severity: LeadQualitySeverity;
  safeDetails: SafeDetails;
}>;

export type NormalizeLeadConfig = Readonly<{
  id: string;
  pipelineId: number;
  wonStatusId: number;
  sourceFieldId: number | null;
}>;

export type NormalizeLeadContext = Readonly<{
  accountId: number;
  config: NormalizeLeadConfig;
  channelRules: readonly ChannelRule[];
  /** Status IDs present in the configured pipeline's metadata. */
  pipelineStatusIds: readonly number[];
  /** ISO 8601 instant with an explicit zone. */
  normalizedAt: string;
}>;

export type NormalizedLead = Readonly<{
  accountId: number;
  amoLeadId: number;
  pipelineId: number;
  currentStatusId: number;
  currentResponsibleUserId: number | null;
  /** Protected stored name; may contain a phone number. */
  name: string;
  /** Name safe for dashboard, CSV and Sheet output: phone numbers never appear. */
  displayName: string;
  priceRub: Rubles | null;
  createdAt: string;
  createdDate: string;
  sourceUpdatedAt: string;
  normalizedChannel: NormalizedChannel;
  channelRuleId: string | null;
  normalizationConfigId: string;
  amoUrl: string;
  isDeleted: false;
  normalizedAt: string;
}>;

export type NormalizedLeadResult =
  | Readonly<{
      status: "normalized";
      lead: NormalizedLead;
      issues: readonly LeadQualityIssueCandidate[];
    }>
  | Readonly<{
      status: "excluded" | "rejected";
      lead: null;
      issues: readonly LeadQualityIssueCandidate[];
    }>;

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const contextSchema = z.object({
  accountId: positiveId,
  config: z.object({
    id: z.string().min(1),
    pipelineId: positiveId,
    wonStatusId: positiveId,
    sourceFieldId: positiveId.nullable(),
  }),
  channelRules: z.array(
    z.object({
      id: z.string().min(1),
      priority: z.number().int(),
      matchType: channelMatchTypeSchema,
      // Stored rule values are non-empty PostgreSQL text, which cannot hold NUL.
      matchValue: z.string().min(1).refine((value) => !value.includes("\u0000")),
      normalizedChannel: normalizedChannelSchema,
      isActive: z.boolean(),
    }),
  ),
  pipelineStatusIds: z.array(positiveId),
  normalizedAt: z.string().refine((value) => parseIsoInstant(value) !== null),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function fallbackName(amoLeadId: number): string {
  return `Сделка #${amoLeadId}`;
}

/**
 * A digit run joined by phone separators, e.g. `+7 (000) 111-22-33`:
 * whitespace, any dash, invisible format characters, minus sign and
 * `( ) . + / _ , :`.
 */
const DIGIT_RUN = /\+?\p{Nd}(?:[\s\p{Pd}\p{Cf}\u2212().+/_,:]*\p{Nd})*/gu;
const MIN_PHONE_DIGITS = 10;

function hasVisibleText(name: string): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(name);
}

function countDigits(text: string): number {
  return text.match(/\p{Nd}/gu)?.length ?? 0;
}

/** SPEC M5.5: a name made up mainly of a phone number is never displayed. */
function isPhoneLike(name: string): boolean {
  const digits = countDigits(name);
  const visible = Array.from(name.replace(/\s/gu, "")).length;
  return digits >= MIN_PHONE_DIGITS && digits * 2 >= visible;
}

/** SECURITY_READ_ONLY section 7: phones inside a name are masked. */
function maskPhones(name: string): string {
  return name.replace(DIGIT_RUN, (run) =>
    countDigits(run) >= MIN_PHONE_DIGITS
      ? `*** ***-**-${(run.match(/\p{Nd}/gu) ?? []).slice(-2).join("")}`
      : run,
  );
}

/**
 * The name safe for dashboards, CSV, Sheets and immutable snapshots: a name
 * that is mostly a phone number becomes the stable fallback, and any phone
 * inside a longer name is masked.
 */
export function displayNameFor(name: string, amoLeadId: number): string {
  return isPhoneLike(name) ? fallbackName(amoLeadId) : maskPhones(name);
}

function channelIssues(channel: ChannelMatch): Array<[LeadQualityCode, SafeDetails]> {
  if (channel.normalizedChannel !== "unknown") return [];
  const issues: Array<[LeadQualityCode, SafeDetails]> = [];
  if (channel.conflict && channel.matchType) {
    issues.push(["channel_rule_conflict", { matchType: channel.matchType }]);
  }
  issues.push([
    "unknown_channel",
    { reason: channel.reason === "matched" ? "mapped_to_unknown" : channel.reason },
  ]);
  return issues;
}

function toIssues(
  accountId: number,
  amoLeadId: number | null,
  found: ReadonlyArray<readonly [LeadQualityCode, SafeDetails]>,
): LeadQualityIssueCandidate[] {
  return found
    .map(([code, safeDetails]) => ({
      accountId,
      amoLeadId,
      code,
      severity: LEAD_ISSUE_SEVERITY[code],
      safeDetails,
    }))
    .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

/**
 * Converts one raw amoCRM lead snapshot into a normalized lead plus quality
 * issue candidates. Pure and deterministic: it never throws for malformed
 * JSON-shaped source data (as stored in raw JSONB) and never guesses missing
 * values. Invalid context is a programming error and throws.
 */
export function normalizeLead(
  raw: unknown,
  context: NormalizeLeadContext,
): NormalizedLeadResult {
  const parsedContext = contextSchema.safeParse(context);
  if (!parsedContext.success) throw new AppError("E_VALIDATION", 422);
  const { accountId, config } = context;

  if (!isRecord(raw)) {
    return {
      status: "rejected",
      lead: null,
      issues: toIssues(accountId, null, [
        ["malformed_lead", { reasons: "not_an_object" }],
      ]),
    };
  }

  const amoLeadId = positiveSafeInteger(raw.id);
  const payloadAccountId = positiveSafeInteger(raw.account_id);
  const pipelineId = positiveSafeInteger(raw.pipeline_id);
  const statusId = positiveSafeInteger(raw.status_id);
  const createdAt = unixSecondsToInstant(raw.created_at);
  const sourceUpdatedAt = unixSecondsToInstant(raw.updated_at);

  const malformed = [
    amoLeadId === null ? "invalid_id" : null,
    payloadAccountId === null ? "invalid_account" : null,
    pipelineId === null ? "invalid_pipeline" : null,
    statusId === null ? "invalid_status" : null,
  ].filter((reason) => reason !== null);
  const accountMismatch =
    payloadAccountId !== null && payloadAccountId !== accountId;
  const identityValid =
    amoLeadId !== null && payloadAccountId !== null && pipelineId !== null;

  // A lead of another pipeline is never reported on, so its remaining
  // defects must not raise blocking issues for this configuration.
  if (identityValid && !accountMismatch && pipelineId !== config.pipelineId) {
    return {
      status: "excluded",
      lead: null,
      issues: toIssues(accountId, amoLeadId, [
        ["out_of_scope_pipeline", { pipelineId }],
      ]),
    };
  }

  const rejections: Array<[LeadQualityCode, SafeDetails]> = [];
  if (malformed.length > 0) {
    rejections.push(["malformed_lead", { reasons: malformed.join(",") }]);
  }
  if (accountMismatch) rejections.push(["account_mismatch", {}]);
  if (createdAt === null) rejections.push(["invalid_created_at", {}]);
  if (sourceUpdatedAt === null) rejections.push(["invalid_updated_at", {}]);

  if (
    rejections.length > 0
    || amoLeadId === null
    || pipelineId === null
    || statusId === null
    || createdAt === null
    || sourceUpdatedAt === null
  ) {
    return {
      status: "rejected",
      lead: null,
      issues: toIssues(accountId, amoLeadId, rejections),
    };
  }

  const issues: Array<[LeadQualityCode, SafeDetails]> = [];

  if (!context.pipelineStatusIds.includes(statusId)) {
    issues.push(["unknown_current_status", { statusId }]);
  }

  const responsibleUserId = positiveSafeInteger(raw.responsible_user_id);
  if (responsibleUserId === null) issues.push(["missing_responsible", {}]);

  const price = parseAmoRubles(raw.price);
  if (statusId === config.wonStatusId) {
    if (price.status !== "valid") {
      issues.push([
        "won_without_valid_price",
        { reason: price.status === "missing" ? "missing" : price.reason },
      ]);
    } else if (isZeroRubles(price.value)) {
      issues.push(["won_without_valid_price", { reason: "zero" }]);
    }
  } else if (price.status === "invalid") {
    issues.push(["invalid_price", { reason: price.reason }]);
  }

  const channel = matchChannel(
    extractChannelInput(raw, config.sourceFieldId),
    context.channelRules,
  );
  issues.push(...channelIssues(channel));

  const name =
    typeof raw.name === "string" && hasVisibleText(raw.name)
      ? raw.name
      : fallbackName(amoLeadId);

  const lead: NormalizedLead = {
    accountId,
    amoLeadId,
    pipelineId,
    currentStatusId: statusId,
    currentResponsibleUserId: responsibleUserId,
    name,
    displayName: displayNameFor(name, amoLeadId),
    priceRub: price.value,
    createdAt,
    createdDate: toMoscowDate(createdAt),
    sourceUpdatedAt,
    normalizedChannel: channel.normalizedChannel,
    channelRuleId: channel.ruleId,
    normalizationConfigId: config.id,
    amoUrl: `${AMO_LEAD_URL_PREFIX}${amoLeadId}`,
    isDeleted: false,
    normalizedAt: parseIsoInstant(context.normalizedAt)!.toISOString(),
  };

  return {
    status: "normalized",
    lead,
    issues: toIssues(accountId, amoLeadId, issues),
  };
}
