import type {
  ChannelRuleCandidate,
  ResolvedPipelineConfig,
} from "@real2/domain";
import { AppError, validateChannelRules } from "@real2/domain";
import type { TransactionSql } from "postgres";

import type { Database } from "./client.js";

type ConfigRow = {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  application_status_id: string;
  application_status_name: string;
  won_status_id: string;
  won_status_name: string;
  source_field_id: string | null;
  timezone: "Europe/Moscow";
  version: number;
  confirmed_at: Date;
  checked_at: Date;
  pipeline_found: boolean;
  application_status_found: boolean;
  won_status_found: boolean;
  source_field_found: boolean;
  metadata_checksum: string;
};

type ChannelRuleRow = {
  id: string;
  priority: number;
  match_type: ChannelRuleCandidate["matchType"];
  match_value: string;
  normalized_channel: ChannelRuleCandidate["normalizedChannel"];
  is_active: boolean;
  created_at: Date;
};

export type ActivePipelineConfig = Readonly<{
  id: string;
  pipelineId: number;
  pipelineName: string;
  applicationStatusId: number;
  applicationStatusName: string;
  wonStatusId: number;
  wonStatusName: string;
  sourceFieldId: number | null;
  timezone: "Europe/Moscow";
  version: number;
  confirmedAt: Date;
  metadataChecksum: string;
  validation: Readonly<{
    checkedAt: Date;
    pipelineFound: boolean;
    applicationStatusFound: boolean;
    wonStatusFound: boolean;
    sourceFieldFound: boolean;
  }>;
  channelRules: readonly ActiveChannelRule[];
}>;

export type ActiveChannelRule = Readonly<{
  id: string;
  priority: number;
  matchType: ChannelRuleCandidate["matchType"];
  matchValue: string;
  normalizedChannel: ChannelRuleCandidate["normalizedChannel"];
  isActive: boolean;
  createdAt: Date;
}>;

export type ActivatePipelineConfigInput = Readonly<{
  amoConnectionId: string;
  expectedActiveConfigId: string | null;
  candidate: ResolvedPipelineConfig;
  channelRules: readonly ChannelRuleCandidate[];
  metadataChecksum: string;
  actorId: string;
  now?: Date;
}>;

function databaseError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "23505" || code === "23503" || code === "23514") {
      throw new AppError("E_CONFLICT", 409);
    }
  }
  throw error;
}

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError("E_DB", 500);
  return parsed;
}

function mapRule(row: ChannelRuleRow): ActiveChannelRule {
  return {
    id: row.id,
    priority: row.priority,
    matchType: row.match_type,
    matchValue: row.match_value,
    normalizedChannel: row.normalized_channel,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapConfig(
  row: ConfigRow,
  channelRules: readonly ActiveChannelRule[],
): ActivePipelineConfig {
  return {
    id: row.id,
    pipelineId: safeInteger(row.pipeline_id),
    pipelineName: row.pipeline_name,
    applicationStatusId: safeInteger(row.application_status_id),
    applicationStatusName: row.application_status_name,
    wonStatusId: safeInteger(row.won_status_id),
    wonStatusName: row.won_status_name,
    sourceFieldId: row.source_field_id ? safeInteger(row.source_field_id) : null,
    timezone: row.timezone,
    version: row.version,
    confirmedAt: row.confirmed_at,
    metadataChecksum: row.metadata_checksum,
    validation: {
      checkedAt: row.checked_at,
      pipelineFound: row.pipeline_found,
      applicationStatusFound: row.application_status_found,
      wonStatusFound: row.won_status_found,
      sourceFieldFound: row.source_field_found,
    },
    channelRules,
  };
}

async function selectRules(
  db: Database | TransactionSql,
  configId: string,
): Promise<readonly ActiveChannelRule[]> {
  const rows = await db<ChannelRuleRow[]>`
    select
      id,
      priority,
      match_type,
      match_value,
      normalized_channel,
      is_active,
      created_at
    from public.channel_rules
    where config_id = ${configId}
    order by priority, id
  `;
  return rows.map(mapRule);
}

async function selectActiveConfigRow(
  db: Database | TransactionSql,
  connectionId: string,
): Promise<ConfigRow | null> {
  const [row] = await db<ConfigRow[]>`
    select
      config.id,
      config.pipeline_id,
      config.pipeline_name,
      config.application_status_id,
      config.application_status_name,
      config.won_status_id,
      config.won_status_name,
      config.source_field_id,
      config.timezone,
      config.version,
      config.confirmed_at,
      validation.checked_at,
      validation.pipeline_found,
      validation.application_status_found,
      validation.won_status_found,
      validation.source_field_found,
      validation.metadata_checksum
    from public.pipeline_configs as config
    join lateral (
      select
        checked_at,
        pipeline_found,
        application_status_found,
        won_status_found,
        source_field_found,
        metadata_checksum
      from public.config_validations
      where config_id = config.id
      order by checked_at desc, id desc
      limit 1
    ) as validation on true
    where config.amo_connection_id = ${connectionId}
      and config.is_active
    limit 1
  `;
  return row ?? null;
}

export async function getActivePipelineConfig(
  db: Database,
  connectionId: string,
): Promise<ActivePipelineConfig | null> {
  const row = await selectActiveConfigRow(db, connectionId);
  if (!row) return null;
  return mapConfig(row, await selectRules(db, row.id));
}

export async function activatePipelineConfig(
  db: Database,
  input: ActivatePipelineConfigInput,
): Promise<ActivePipelineConfig> {
  const channelRules = validateChannelRules(input.channelRules);
  const metadataChecksum = input.metadataChecksum;
  if (!/^[a-f0-9]{64}$/.test(metadataChecksum)) {
    throw new AppError("E_VALIDATION", 422);
  }
  const now = input.now ?? new Date();

  try {
    return await db.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtextextended(${input.amoConnectionId}, 1))
      `;
      const [connection] = await transaction<{
        id: string;
        status: string;
      }[]>`
        select id, status
        from public.amo_connections
        where id = ${input.amoConnectionId}
        for update
      `;
      if (!connection || connection.status !== "active") {
        throw new AppError("E_CONFIG_INCOMPLETE", 422);
      }

      const lockedConfigs = await transaction<{
        id: string;
        is_active: boolean;
      }[]>`
        select id, is_active
        from public.pipeline_configs
        where amo_connection_id = ${input.amoConnectionId}
        for update
      `;
      const currentActiveConfigId =
        lockedConfigs.find((config) => config.is_active)?.id ?? null;
      if (currentActiveConfigId !== input.expectedActiveConfigId) {
        throw new AppError("E_CONFLICT", 409);
      }

      const [versionRow] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0) + 1 as version
        from public.pipeline_configs
        where amo_connection_id = ${input.amoConnectionId}
      `;
      if (!versionRow) throw new AppError("E_DB", 500);

      await transaction`
        update public.pipeline_configs
        set is_active = false
        where amo_connection_id = ${input.amoConnectionId}
          and is_active
      `;

      const [config] = await transaction<{ id: string }[]>`
        insert into public.pipeline_configs (
          amo_connection_id,
          pipeline_id,
          pipeline_name,
          application_status_id,
          application_status_name,
          won_status_id,
          won_status_name,
          source_field_id,
          version,
          is_active,
          confirmed_by,
          confirmed_at
        ) values (
          ${input.amoConnectionId},
          ${input.candidate.pipelineId},
          ${input.candidate.pipelineName},
          ${input.candidate.applicationStatusId},
          ${input.candidate.applicationStatusName},
          ${input.candidate.wonStatusId},
          ${input.candidate.wonStatusName},
          ${input.candidate.channelFieldId},
          ${versionRow.version},
          true,
          ${input.actorId},
          ${now}
        )
        returning id
      `;
      if (!config) throw new AppError("E_DB", 500);

      for (const rule of channelRules) {
        await transaction`
          insert into public.channel_rules (
            config_id,
            priority,
            match_type,
            match_value,
            normalized_channel,
            is_active,
            created_by
          ) values (
            ${config.id},
            ${rule.priority},
            ${rule.matchType},
            ${rule.matchValue},
            ${rule.normalizedChannel},
            ${input.candidate.channelFieldId !== null || rule.matchType !== "source_field_exact"},
            ${input.actorId}
          )
        `;
      }

      await transaction`
        insert into public.config_validations (
          config_id,
          checked_at,
          pipeline_found,
          application_status_found,
          won_status_found,
          source_field_found,
          metadata_checksum,
          details
        ) values (
          ${config.id},
          ${now},
          true,
          true,
          true,
          ${input.candidate.channelFieldId !== null},
          ${metadataChecksum},
          ${transaction.json({
            pipeline: {
              id: input.candidate.pipelineId,
              name: input.candidate.pipelineName,
            },
            applicationStatus: {
              id: input.candidate.applicationStatusId,
              name: input.candidate.applicationStatusName,
            },
            wonStatus: {
              id: input.candidate.wonStatusId,
              name: input.candidate.wonStatusName,
            },
          })}
        )
      `;

      await transaction`
        insert into public.config_recalculation_requests (
          config_id,
          requested_by,
          requested_at,
          status
        ) values (${config.id}, ${input.actorId}, ${now}, 'queued')
      `;

      const row = await selectActiveConfigRow(transaction, input.amoConnectionId);
      if (!row) throw new AppError("E_DB", 500);
      return mapConfig(row, await selectRules(transaction, row.id));
    });
  } catch (error) {
    databaseError(error);
  }
}
