import type { z } from "zod";

import type {
  channelMatchTypeSchema,
  normalizedChannelSchema,
} from "../amo/config.js";

export type NormalizedChannel = z.infer<typeof normalizedChannelSchema>;
export type ChannelMatchType = z.infer<typeof channelMatchTypeSchema>;

/** One persisted, versioned channel rule of the active configuration. */
export type ChannelRule = Readonly<{
  id: string;
  priority: number;
  matchType: ChannelMatchType;
  matchValue: string;
  normalizedChannel: NormalizedChannel;
  isActive: boolean;
}>;

export type ChannelInput = Readonly<{
  valuesByMatchType: Readonly<Record<ChannelMatchType, readonly string[]>>;
}>;

export type ChannelMatchReason =
  | "matched"
  | "no_matching_rule"
  | "unmapped_source_field"
  | "rule_conflict";

export type ChannelMatch = Readonly<{
  normalizedChannel: NormalizedChannel;
  ruleId: string | null;
  /** Source kind that decided the result; null when no kind had a match. */
  matchType: ChannelMatchType | null;
  conflict: boolean;
  reason: ChannelMatchReason;
}>;

/** METRICS_CATALOG section 7 source priority. */
const MATCH_TYPE_ORDER = [
  "source_field_exact",
  "tag_exact",
  "integration_source_exact",
] as const satisfies readonly ChannelMatchType[];

function compareRules(left: ChannelRule, right: ChannelRule): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/**
 * Resolves the normalized channel from exact, active rules only. A filled
 * source field decides on its own; tags and integration sources count only
 * when a confirmed rule matches them. Deal names and free text are never read.
 */
export function matchChannel(
  input: ChannelInput,
  rules: readonly ChannelRule[],
): ChannelMatch {
  for (const matchType of MATCH_TYPE_ORDER) {
    const values = input.valuesByMatchType[matchType];
    if (values.length === 0) continue;

    const matches = rules
      .filter(
        (rule) =>
          rule.isActive
          && rule.matchType === matchType
          && values.includes(rule.matchValue),
      )
      .sort(compareRules);
    const channels = new Set(matches.map((rule) => rule.normalizedChannel));

    if (channels.size > 1) {
      return unknown(matchType, true, "rule_conflict");
    }
    const [winner] = matches;
    if (winner) {
      return {
        normalizedChannel: winner.normalizedChannel,
        ruleId: winner.id,
        matchType,
        conflict: false,
        reason: "matched",
      };
    }
    if (matchType === "source_field_exact") {
      return unknown(matchType, false, "unmapped_source_field");
    }
  }
  return unknown(null, false, "no_matching_rule");
}

function unknown(
  matchType: ChannelMatchType | null,
  conflict: boolean,
  reason: ChannelMatchReason,
): ChannelMatch {
  return { normalizedChannel: "unknown", ruleId: null, matchType, conflict, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function filledText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Collects exact channel evidence from an amoCRM API v4 lead payload:
 * the configured custom field, `_embedded.tags[].name` and
 * `_embedded.source.name`. Malformed shapes yield no values.
 */
export function extractChannelInput(
  raw: unknown,
  sourceFieldId: number | null,
): ChannelInput {
  const lead = isRecord(raw) ? raw : {};
  const embedded = isRecord(lead._embedded) ? lead._embedded : {};

  const sourceFieldValues =
    sourceFieldId === null
      ? []
      : records(lead.custom_fields_values)
          .filter((field) => field.field_id === sourceFieldId)
          .flatMap((field) => records(field.values))
          .map((item) => item.value)
          .filter(filledText);

  const tagValues = records(embedded.tags)
    .map((tag) => tag.name)
    .filter(filledText);

  const integrationSource = isRecord(embedded.source) ? embedded.source.name : null;

  return {
    valuesByMatchType: {
      source_field_exact: sourceFieldValues,
      tag_exact: tagValues,
      integration_source_exact: filledText(integrationSource) ? [integrationSource] : [],
    },
  };
}
