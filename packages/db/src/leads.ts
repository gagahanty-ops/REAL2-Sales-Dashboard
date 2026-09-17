import type { Database } from "./client.js";

export type NormalizedLeadKey = Readonly<{
  accountId: number;
  amoLeadId: number;
}>;

export type UpsertAmoUserInput = Readonly<{
  accountId: number;
  amoUserId: number;
  name: string;
  email: string | null;
  isActive: boolean;
  sourceUpdatedAt: Date | null;
}>;

export type UpsertPipelineStatusInput = Readonly<{
  accountId: number;
  pipelineId: number;
  statusId: number;
  name: string;
  sortOrder: number;
  isClosed: boolean;
  isWon: boolean;
  sourceUpdatedAt: Date | null;
}>;

export type UpsertLeadInput = Readonly<{
  accountId: number;
  amoLeadId: number;
  pipelineId: number;
  currentStatusId: number;
  currentResponsibleUserId: number | null;
  name: string;
  priceRub: number | null;
  createdAt: Date;
  createdDate: string;
  sourceUpdatedAt: Date;
  normalizedChannel: string;
  channelRuleId: string | null;
  normalizationConfigId: string;
  amoUrl: string;
  isDeleted: boolean;
}>;

export type AppendStageEventInput = Readonly<{
  accountId: number;
  amoEventId: string;
  amoLeadId: number;
  fromStatusId: number | null;
  toStatusId: number;
  responsibleUserId: number | null;
  occurredAt: Date;
}>;

export type AppendResponsibleEventInput = Readonly<{
  accountId: number;
  amoEventId: string;
  amoLeadId: number;
  fromUserId: number | null;
  toUserId: number | null;
  occurredAt: Date;
}>;

export type UpsertLeadMilestoneInput = Readonly<{
  accountId: number;
  amoLeadId: number;
  applicationAt: Date | null;
  applicationResponsibleUserId: number | null;
  wonAt: Date | null;
  wonResponsibleUserId: number | null;
  currentlyWon: boolean;
  recalculatedAt?: Date;
}>;

export type NormalizedLeadRepository = Readonly<{
  upsertAmoUser(input: UpsertAmoUserInput): Promise<void>;
  upsertPipelineStatus(input: UpsertPipelineStatusInput): Promise<void>;
  upsertLead(input: UpsertLeadInput): Promise<void>;
  appendStageEvent(input: AppendStageEventInput): Promise<void>;
  appendResponsibleEvent(input: AppendResponsibleEventInput): Promise<void>;
  upsertMilestone(input: UpsertLeadMilestoneInput): Promise<void>;
}>;

export function createNormalizedLeadRepository(
  db: Database,
): NormalizedLeadRepository {
  return {
    async upsertAmoUser(input) {
      await db`
        insert into public.amo_users (
          account_id, amo_user_id, name, email, is_active, source_updated_at
        ) values (
          ${input.accountId}, ${input.amoUserId}, ${input.name}, ${input.email},
          ${input.isActive}, ${input.sourceUpdatedAt}
        )
        on conflict (account_id, amo_user_id) do update set
          name = excluded.name,
          email = excluded.email,
          is_active = excluded.is_active,
          source_updated_at = excluded.source_updated_at,
          normalized_at = now()
      `;
    },

    async upsertPipelineStatus(input) {
      await db`
        insert into public.pipeline_statuses (
          account_id, pipeline_id, status_id, name, sort_order, is_closed,
          is_won, source_updated_at
        ) values (
          ${input.accountId}, ${input.pipelineId}, ${input.statusId}, ${input.name},
          ${input.sortOrder}, ${input.isClosed}, ${input.isWon}, ${input.sourceUpdatedAt}
        )
        on conflict (account_id, status_id) do update set
          pipeline_id = excluded.pipeline_id,
          name = excluded.name,
          sort_order = excluded.sort_order,
          is_closed = excluded.is_closed,
          is_won = excluded.is_won,
          source_updated_at = excluded.source_updated_at
      `;
    },

    async upsertLead(input) {
      await db`
        insert into public.leads (
          account_id, amo_lead_id, pipeline_id, current_status_id,
          current_responsible_user_id, name, price_rub, created_at, created_date,
          source_updated_at, normalized_channel, channel_rule_id,
          normalization_config_id, amo_url, is_deleted
        ) values (
          ${input.accountId}, ${input.amoLeadId}, ${input.pipelineId},
          ${input.currentStatusId}, ${input.currentResponsibleUserId}, ${input.name},
          ${input.priceRub}, ${input.createdAt}, ${input.createdDate},
          ${input.sourceUpdatedAt}, ${input.normalizedChannel}, ${input.channelRuleId},
          ${input.normalizationConfigId}, ${input.amoUrl}, ${input.isDeleted}
        )
        on conflict (account_id, amo_lead_id) do update set
          pipeline_id = excluded.pipeline_id,
          current_status_id = excluded.current_status_id,
          current_responsible_user_id = excluded.current_responsible_user_id,
          name = excluded.name,
          price_rub = excluded.price_rub,
          created_at = excluded.created_at,
          created_date = excluded.created_date,
          source_updated_at = excluded.source_updated_at,
          normalized_channel = excluded.normalized_channel,
          channel_rule_id = excluded.channel_rule_id,
          normalization_config_id = excluded.normalization_config_id,
          amo_url = excluded.amo_url,
          is_deleted = excluded.is_deleted,
          normalized_at = now()
      `;
    },

    async appendStageEvent(input) {
      await db`
        insert into public.lead_stage_events (
          account_id, amo_event_id, amo_lead_id, from_status_id, to_status_id,
          responsible_user_id, occurred_at
        ) values (
          ${input.accountId}, ${input.amoEventId}, ${input.amoLeadId},
          ${input.fromStatusId}, ${input.toStatusId}, ${input.responsibleUserId},
          ${input.occurredAt}
        )
        on conflict (account_id, amo_event_id) do nothing
      `;
    },

    async appendResponsibleEvent(input) {
      await db`
        insert into public.lead_responsible_events (
          account_id, amo_event_id, amo_lead_id, from_user_id, to_user_id,
          occurred_at
        ) values (
          ${input.accountId}, ${input.amoEventId}, ${input.amoLeadId},
          ${input.fromUserId}, ${input.toUserId}, ${input.occurredAt}
        )
        on conflict (account_id, amo_event_id) do nothing
      `;
    },

    async upsertMilestone(input) {
      await db`
        insert into public.lead_milestones (
          account_id, amo_lead_id, application_at, application_responsible_user_id,
          won_at, won_responsible_user_id, currently_won, recalculated_at
        ) values (
          ${input.accountId}, ${input.amoLeadId}, ${input.applicationAt},
          ${input.applicationResponsibleUserId}, ${input.wonAt},
          ${input.wonResponsibleUserId}, ${input.currentlyWon},
          ${input.recalculatedAt ?? new Date()}
        )
        on conflict (account_id, amo_lead_id) do update set
          application_at = excluded.application_at,
          application_responsible_user_id = excluded.application_responsible_user_id,
          won_at = excluded.won_at,
          won_responsible_user_id = excluded.won_responsible_user_id,
          currently_won = excluded.currently_won,
          recalculated_at = excluded.recalculated_at
      `;
    },
  };
}
