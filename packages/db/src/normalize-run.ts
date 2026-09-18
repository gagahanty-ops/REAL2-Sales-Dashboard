import { AppError } from "@real2/domain";
import type { Database } from "./client.js";
import {
  createNormalizedLeadRepository,
  type AppendResponsibleEventInput,
  type AppendStageEventInput,
  type UpsertAmoUserInput,
  type UpsertLeadInput,
  type UpsertLeadMilestoneInput,
  type UpsertPipelineStatusInput,
} from "./leads.js";
import {
  createQualityRepository,
  type OpenQualityIssueInput,
  type ResolveAbsentIssuesInput,
} from "./quality.js";
import type { SyncStatus } from "./sync-runs.js";

export type NormalizationRun = Readonly<{
  syncRunId: string;
  accountId: number;
  connectionId: string;
  configId: string;
  status: SyncStatus;
  /** Instant the run finished; open stage ages are measured against it. */
  snapshotAt: Date;
}>;

export type RawLeadSnapshot = Readonly<{
  amoLeadId: number;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}>;

export type RawEntitySnapshot = Readonly<{
  externalId: number;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}>;

export type RawHistoryEventRow = Readonly<{
  amoEventId: string;
  amoLeadId: number;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
}>;

export type NormalizedLeadWrite = Readonly<{
  lead: UpsertLeadInput;
  stageEvents: readonly AppendStageEventInput[];
  responsibleEvents: readonly AppendResponsibleEventInput[];
  milestone: UpsertLeadMilestoneInput;
}>;

export type NormalizationWritePlan = Readonly<{
  amoUsers: readonly UpsertAmoUserInput[];
  pipelineStatuses: readonly UpsertPipelineStatusInput[];
  leads: readonly NormalizedLeadWrite[];
  issues: readonly OpenQualityIssueInput[];
  /** Issues of observed leads that stopped appearing are resolved, not deleted. */
  issueLifecycle: ResolveAbsentIssuesInput | null;
}>;

export type NormalizationWriteResult = Readonly<{
  leadsWritten: number;
  stageEventsWritten: number;
  responsibleEventsWritten: number;
  milestonesWritten: number;
  issuesOpened: number;
  issuesResolved: number;
}>;

export type NormalizeRunRepository = Readonly<{
  loadRun(syncRunId: string): Promise<NormalizationRun | null>;
  listRunLeads(syncRunId: string): Promise<readonly RawLeadSnapshot[]>;
  listRunEntities(
    syncRunId: string,
    entityType: "status" | "user",
  ): Promise<readonly RawEntitySnapshot[]>;
  listLeadEvents(
    accountId: number,
    amoLeadIds: readonly number[],
  ): Promise<readonly RawHistoryEventRow[]>;
  listStoredLeadIds(
    accountId: number,
    amoLeadIds: readonly number[],
  ): Promise<readonly number[]>;
  apply(plan: NormalizationWritePlan): Promise<NormalizationWriteResult>;
}>;

type RunRow = {
  id: string;
  connection_id: string;
  config_id: string;
  status: SyncStatus;
  started_at: Date;
  finished_at: Date | null;
  account_id: string;
};

type RawObjectRow = {
  external_id: string;
  source_updated_at: Date | null;
  payload: unknown;
};

type RawEventRow = {
  amo_event_id: string;
  amo_lead_id: string;
  event_type: string;
  event_at: Date;
  payload: unknown;
};

function safePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError("E_DB", 500);
  return parsed;
}

function assertLeadIds(amoLeadIds: readonly number[]): void {
  if (amoLeadIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new AppError("E_VALIDATION", 422);
  }
}

export function createNormalizeRunRepository(db: Database): NormalizeRunRepository {
  return {
    async loadRun(syncRunId) {
      const [row] = await db<RunRow[]>`
        select
          runs.id,
          runs.connection_id,
          runs.config_id,
          runs.status,
          runs.started_at,
          runs.finished_at,
          connections.account_id
        from public.sync_runs as runs
        join public.amo_connections as connections
          on connections.id = runs.connection_id
        where runs.id = ${syncRunId}
      `;
      if (!row) return null;
      return {
        syncRunId: row.id,
        accountId: safePositiveInteger(row.account_id),
        connectionId: row.connection_id,
        configId: row.config_id,
        status: row.status,
        snapshotAt: row.finished_at ?? row.started_at,
      };
    },

    async listRunLeads(syncRunId) {
      const rows = await db<RawObjectRow[]>`
        select external_id, source_updated_at, payload
        from public.raw_amo_objects
        where sync_run_id = ${syncRunId} and entity_type = 'lead'
        order by external_id
      `;
      return rows.map((row) => ({
        amoLeadId: safePositiveInteger(row.external_id),
        sourceUpdatedAt: row.source_updated_at,
        payload: row.payload,
      }));
    },

    async listRunEntities(syncRunId, entityType) {
      const rows = await db<RawObjectRow[]>`
        select external_id, source_updated_at, payload
        from public.raw_amo_objects
        where sync_run_id = ${syncRunId} and entity_type = ${entityType}
        order by external_id
      `;
      return rows.map((row) => ({
        externalId: safePositiveInteger(row.external_id),
        sourceUpdatedAt: row.source_updated_at,
        payload: row.payload,
      }));
    },

    async listLeadEvents(accountId, amoLeadIds) {
      assertLeadIds(amoLeadIds);
      if (amoLeadIds.length === 0) return [];
      const rows = await db<RawEventRow[]>`
        select amo_event_id, amo_lead_id, event_type, event_at, payload
        from public.raw_amo_events
        where account_id = ${accountId}
          and amo_lead_id in ${db(amoLeadIds)}
        order by event_at, amo_event_id
      `;
      return rows.map((row) => ({
        amoEventId: row.amo_event_id,
        amoLeadId: safePositiveInteger(row.amo_lead_id),
        eventType: row.event_type,
        occurredAt: row.event_at,
        payload: row.payload,
      }));
    },

    async listStoredLeadIds(accountId, amoLeadIds) {
      assertLeadIds(amoLeadIds);
      if (amoLeadIds.length === 0) return [];
      const rows = await db<{ amo_lead_id: string }[]>`
        select amo_lead_id
        from public.leads
        where account_id = ${accountId} and amo_lead_id in ${db(amoLeadIds)}
        order by amo_lead_id
      `;
      return rows.map((row) => safePositiveInteger(row.amo_lead_id));
    },

    async apply(plan) {
      return db.begin(async (transaction) => {
        const repository = createNormalizedLeadRepository(transaction);
        const quality = createQualityRepository(transaction);

        for (const user of plan.amoUsers) await repository.upsertAmoUser(user);
        for (const status of plan.pipelineStatuses) {
          await repository.upsertPipelineStatus(status);
        }

        let stageEventsWritten = 0;
        let responsibleEventsWritten = 0;
        for (const write of plan.leads) {
          await repository.upsertLead(write.lead);
          // Stage and responsible rows are append-only: the worker holds no
          // update or delete privilege on them, which keeps the derived history
          // an audit trail. Recalculation lands in `lead_milestones`.
          for (const event of write.stageEvents) {
            await repository.appendStageEvent(event);
            stageEventsWritten += 1;
          }
          for (const event of write.responsibleEvents) {
            await repository.appendResponsibleEvent(event);
            responsibleEventsWritten += 1;
          }
          await repository.upsertMilestone(write.milestone);
        }

        for (const issue of plan.issues) await quality.open(issue);
        const issuesResolved = plan.issueLifecycle
          ? await quality.resolveAbsent(plan.issueLifecycle)
          : 0;

        return {
          leadsWritten: plan.leads.length,
          stageEventsWritten,
          responsibleEventsWritten,
          milestonesWritten: plan.leads.length,
          issuesOpened: plan.issues.length,
          issuesResolved,
        };
      });
    },
  };
}
