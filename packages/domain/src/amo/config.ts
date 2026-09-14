import { createHash } from "node:crypto";

import { z } from "zod";

import { AppError } from "../errors.js";

const EXPECTED_PIPELINE_NAME = "РЕАЛ ДВА";
const EXPECTED_APPLICATION_STATUS_NAME =
  "Завершение (самовывоз или доставка)";
const EXPECTED_WON_STATUS_NAME = "Успешно реализовано";

export const normalizedChannelSchema = z.enum([
  "phone_uis",
  "whatsapp",
  "avito",
  "instagram",
  "site",
  "telegram",
  "max",
  "unknown",
]);

export const channelMatchTypeSchema = z.enum([
  "source_field_exact",
  "tag_exact",
  "integration_source_exact",
]);

export const channelRuleCandidateSchema = z.strictObject({
  priority: z.number().int().min(1).max(1_000),
  matchType: channelMatchTypeSchema,
  matchValue: z.string().min(1).max(500),
  normalizedChannel: normalizedChannelSchema,
});

export type ChannelRuleCandidate = z.infer<typeof channelRuleCandidateSchema>;

const pipelineStatusSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const pipelineDiscoverySchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
  statuses: z.array(pipelineStatusSchema),
});

const customFieldSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

const amoUserSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(500),
});

export const amoConfigDiscoverySchema = z.strictObject({
  pipelines: z.array(pipelineDiscoverySchema),
  leadCustomFields: z.array(customFieldSchema),
  users: z.array(amoUserSchema),
});

export type AmoConfigDiscovery = z.infer<typeof amoConfigDiscoverySchema>;

export const pipelineConfigCandidateSchema = z.strictObject({
  pipelineId: z.number().int().positive(),
  applicationStatusId: z.number().int().positive(),
  wonStatusId: z.number().int().positive(),
  channelFieldId: z.number().int().positive().nullable().optional(),
});

export type PipelineConfigCandidate = z.infer<typeof pipelineConfigCandidateSchema>;

export type ResolvedPipelineConfig = Readonly<{
  pipelineId: number;
  pipelineName: string;
  applicationStatusId: number;
  applicationStatusName: string;
  wonStatusId: number;
  wonStatusName: string;
  channelFieldId: number | null;
  channelFieldName: string | null;
}>;

export type PipelineConfigValidation =
  | Readonly<{
      valid: true;
      metadataChecksum: string;
      resolved: ResolvedPipelineConfig;
    }>
  | Readonly<{
      valid: false;
      code: "E_CONFIG_INCOMPLETE";
      metadataChecksum: string;
      reasons: readonly string[];
    }>;

type RequiredChannelMapping = Readonly<{
  matchValue: string;
  normalizedChannel: z.infer<typeof normalizedChannelSchema>;
}>;

const requiredChannelMappings = [
  { matchValue: "Звонок", normalizedChannel: "phone_uis" },
  { matchValue: "UIS", normalizedChannel: "phone_uis" },
  { matchValue: "uis", normalizedChannel: "phone_uis" },
  { matchValue: "WhatsApp", normalizedChannel: "whatsapp" },
  { matchValue: "Whatsapp", normalizedChannel: "whatsapp" },
  { matchValue: "Avito", normalizedChannel: "avito" },
  { matchValue: "Авито", normalizedChannel: "avito" },
  { matchValue: "Instagram", normalizedChannel: "instagram" },
  { matchValue: "Сайт Real2 - диалоговое окно", normalizedChannel: "site" },
  { matchValue: "Tilda", normalizedChannel: "site" },
  { matchValue: "tilda", normalizedChannel: "site" },
  { matchValue: "сайт", normalizedChannel: "site" },
  { matchValue: "Telegram", normalizedChannel: "telegram" },
  { matchValue: "MAX", normalizedChannel: "max" },
] as const satisfies readonly RequiredChannelMapping[];

export const INITIAL_CHANNEL_RULES: readonly ChannelRuleCandidate[] =
  requiredChannelMappings.map((mapping, index) => ({
    priority: index + 1,
    matchType: "source_field_exact",
    matchValue: mapping.matchValue,
    normalizedChannel: mapping.normalizedChannel,
  }));

function sortByIdAndName<T extends { id: number; name: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) =>
    left.id === right.id
      ? left.name.localeCompare(right.name, "ru")
      : left.id - right.id,
  );
}

export function checksumAmoConfigDiscovery(discovery: AmoConfigDiscovery): string {
  const parsed = amoConfigDiscoverySchema.parse(discovery);
  const canonical = {
    pipelines: sortByIdAndName(parsed.pipelines).map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      statuses: sortByIdAndName(pipeline.statuses).map((status) => ({
        id: status.id,
        name: status.name,
      })),
    })),
    leadCustomFields: sortByIdAndName(parsed.leadCustomFields).map((field) => ({
      id: field.id,
      name: field.name,
    })),
    users: sortByIdAndName(parsed.users).map((user) => ({
      id: user.id,
      name: user.name,
    })),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validatePipelineConfig(
  candidate: PipelineConfigCandidate,
  discovery: AmoConfigDiscovery,
): PipelineConfigValidation {
  const parsedCandidate = pipelineConfigCandidateSchema.parse(candidate);
  const parsedDiscovery = amoConfigDiscoverySchema.parse(discovery);
  const metadataChecksum = checksumAmoConfigDiscovery(parsedDiscovery);
  const reasons: string[] = [];
  const pipeline = parsedDiscovery.pipelines.find(
    (item) => item.id === parsedCandidate.pipelineId,
  );

  if (!pipeline || pipeline.name !== EXPECTED_PIPELINE_NAME) {
    reasons.push("pipeline_not_confirmed");
  }

  const applicationStatus = pipeline?.statuses.find(
    (item) => item.id === parsedCandidate.applicationStatusId,
  );
  if (
    !applicationStatus ||
    applicationStatus.name !== EXPECTED_APPLICATION_STATUS_NAME
  ) {
    reasons.push("application_status_not_confirmed");
  }

  const wonStatus = pipeline?.statuses.find(
    (item) => item.id === parsedCandidate.wonStatusId,
  );
  if (!wonStatus || wonStatus.name !== EXPECTED_WON_STATUS_NAME) {
    reasons.push("won_status_not_confirmed");
  }

  if (parsedCandidate.applicationStatusId === parsedCandidate.wonStatusId) {
    reasons.push("application_and_won_must_differ");
  }

  const requestedFieldId = parsedCandidate.channelFieldId ?? null;
  const channelField = requestedFieldId
    ? parsedDiscovery.leadCustomFields.find((item) => item.id === requestedFieldId)
    : null;
  if (requestedFieldId && !channelField) {
    reasons.push("channel_field_not_confirmed");
  }

  if (reasons.length > 0 || !pipeline || !applicationStatus || !wonStatus) {
    return {
      valid: false,
      code: "E_CONFIG_INCOMPLETE",
      metadataChecksum,
      reasons,
    };
  }

  return {
    valid: true,
    metadataChecksum,
    resolved: {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      applicationStatusId: applicationStatus.id,
      applicationStatusName: applicationStatus.name,
      wonStatusId: wonStatus.id,
      wonStatusName: wonStatus.name,
      channelFieldId: requestedFieldId,
      channelFieldName: channelField?.name ?? null,
    },
  };
}

export function validateChannelRules(
  rules: readonly ChannelRuleCandidate[],
): readonly ChannelRuleCandidate[] {
  const parsed = z.array(channelRuleCandidateSchema).min(1).parse(rules);
  const keys = parsed.map((rule) => `${rule.matchType}\u0000${rule.matchValue}`);
  if (new Set(keys).size !== keys.length) {
    throw new AppError("E_VALIDATION", 422);
  }

  const priorities = parsed.map((rule) => rule.priority);
  if (new Set(priorities).size !== priorities.length) {
    throw new AppError("E_VALIDATION", 422);
  }

  const sourcePriority = {
    source_field_exact: 0,
    tag_exact: 1,
    integration_source_exact: 2,
  } as const;
  const prioritiesByMatchType = [...parsed]
    .sort((left, right) => left.priority - right.priority)
    .map((rule) => sourcePriority[rule.matchType]);
  if (
    prioritiesByMatchType.some(
      (priority, index) => index > 0 && priority < prioritiesByMatchType[index - 1]!,
    )
  ) {
    throw new AppError("E_VALIDATION", 422);
  }

  const missingRequiredMapping = requiredChannelMappings.some(
    (expected) =>
      !parsed.some(
        (rule) =>
          rule.matchType === "source_field_exact" &&
          rule.matchValue === expected.matchValue &&
          rule.normalizedChannel === expected.normalizedChannel,
      ),
  );
  if (missingRequiredMapping) {
    throw new AppError("E_CONFIG_INCOMPLETE", 422);
  }

  return parsed;
}
