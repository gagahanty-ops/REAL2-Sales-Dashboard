import type { ActivePipelineConfig } from "@real2/db";

export type PublicPipelineConfig = Readonly<{
  pipelineId: number;
  pipelineName: string;
  applicationStatusId: number;
  applicationStatusName: string;
  wonStatusId: number;
  wonStatusName: string;
  sourceFieldId: number | null;
  timezone: "Europe/Moscow";
  version: number;
  confirmedAt: string;
  metadataChecksum: string;
  validation: Readonly<{
    checkedAt: string;
    pipelineFound: boolean;
    applicationStatusFound: boolean;
    wonStatusFound: boolean;
    sourceFieldFound: boolean;
  }>;
  channelRules: readonly Readonly<{
    priority: number;
    matchType: string;
    matchValue: string;
    normalizedChannel: string;
    isActive: boolean;
  }>[];
}>;

export function toPublicPipelineConfig(
  config: ActivePipelineConfig,
): PublicPipelineConfig {
  return {
    pipelineId: config.pipelineId,
    pipelineName: config.pipelineName,
    applicationStatusId: config.applicationStatusId,
    applicationStatusName: config.applicationStatusName,
    wonStatusId: config.wonStatusId,
    wonStatusName: config.wonStatusName,
    sourceFieldId: config.sourceFieldId,
    timezone: config.timezone,
    version: config.version,
    confirmedAt: config.confirmedAt.toISOString(),
    metadataChecksum: config.metadataChecksum,
    validation: {
      checkedAt: config.validation.checkedAt.toISOString(),
      pipelineFound: config.validation.pipelineFound,
      applicationStatusFound: config.validation.applicationStatusFound,
      wonStatusFound: config.validation.wonStatusFound,
      sourceFieldFound: config.validation.sourceFieldFound,
    },
    channelRules: config.channelRules.map((rule) => ({
      priority: rule.priority,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      normalizedChannel: rule.normalizedChannel,
      isActive: rule.isActive,
    })),
  };
}
