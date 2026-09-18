import type {
  ActivePipelineConfig,
  NormalizationWritePlan,
  NormalizedLeadWrite,
  NormalizeRunRepository,
  RawEntitySnapshot,
  RawHistoryEventRow,
} from "@real2/db";
import type {
  ChannelRule,
  LeadHistoryEvent,
  LeadQualitySeverity,
  NormalizedLead,
  PipelineStatusOrder,
} from "@real2/domain";
import {
  AppError,
  HISTORY_ISSUE_SEVERITY,
  buildLeadHistory,
  extractHistoryEvent,
  normalizeLead,
} from "@real2/domain";

export type NormalizeSyncRunDeps = Readonly<{
  repository: NormalizeRunRepository;
  loadActiveConfig(connectionId: string): Promise<ActivePipelineConfig | null>;
  now?(): Date;
}>;

export type NormalizeRunResult = Readonly<{
  syncRunId: string;
  leadsNormalized: number;
  leadsExcluded: number;
  leadsRejected: number;
  /** Stored leads that left the configured pipeline; their issue is escalated. */
  leadsOutOfScope: number;
  stageEventsWritten: number;
  responsibleEventsWritten: number;
  issuesOpened: number;
  malformedEvents: number;
}>;

type QualityIssueWrite = NormalizationWritePlan["issues"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function toChannelRules(config: ActivePipelineConfig): readonly ChannelRule[] {
  return config.channelRules.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    normalizedChannel: rule.normalizedChannel,
    isActive: rule.isActive,
  }));
}

type PipelineStatusPlan = Readonly<{
  upserts: NormalizationWritePlan["pipelineStatuses"];
  order: readonly PipelineStatusOrder[];
  statusIds: readonly number[];
}>;

/**
 * `is_won` is the configured won status and `is_closed` equals it: amoCRM's
 * undocumented status `type` field is never guessed (brief ruling R12).
 */
function planPipelineStatuses(
  accountId: number,
  config: ActivePipelineConfig,
  snapshots: readonly RawEntitySnapshot[],
): PipelineStatusPlan {
  const upserts: NormalizationWritePlan["pipelineStatuses"][number][] = [];
  const order: PipelineStatusOrder[] = [];
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot.payload)) continue;
    const pipelineId = positiveSafeInteger(snapshot.payload.pipeline_id);
    const name = snapshot.payload.name;
    if (pipelineId !== config.pipelineId || typeof name !== "string" || name === "") {
      continue;
    }
    const sortOrder = Number.isSafeInteger(snapshot.payload.sort)
      ? (snapshot.payload.sort as number)
      : 0;
    const isWon = snapshot.externalId === config.wonStatusId;
    upserts.push({
      accountId,
      pipelineId,
      statusId: snapshot.externalId,
      name,
      sortOrder,
      isClosed: isWon,
      isWon,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
    });
    order.push({ statusId: snapshot.externalId, sortOrder });
  }
  return { upserts, order, statusIds: order.map((status) => status.statusId) };
}

function planAmoUsers(
  accountId: number,
  snapshots: readonly RawEntitySnapshot[],
): NormalizationWritePlan["amoUsers"] {
  const users: NormalizationWritePlan["amoUsers"][number][] = [];
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot.payload)) continue;
    const name = snapshot.payload.name;
    if (typeof name !== "string" || name === "") continue;
    const rights = isRecord(snapshot.payload.rights) ? snapshot.payload.rights : {};
    const email = snapshot.payload.email;
    users.push({
      accountId,
      amoUserId: snapshot.externalId,
      name,
      email: typeof email === "string" && email !== "" ? email : null,
      isActive: rights.is_active === undefined ? true : rights.is_active === true,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
    });
  }
  return users;
}

type LeadEvents = Readonly<{
  events: readonly LeadHistoryEvent[];
  malformed: number;
}>;

function groupLeadEvents(
  rows: readonly RawHistoryEventRow[],
): ReadonlyMap<number, LeadEvents> {
  const grouped = new Map<number, { events: LeadHistoryEvent[]; malformed: number }>();
  for (const row of rows) {
    const bucket = grouped.get(row.amoLeadId) ?? { events: [], malformed: 0 };
    const extraction = extractHistoryEvent({
      amoEventId: row.amoEventId,
      eventType: row.eventType,
      occurredAt: row.occurredAt.toISOString(),
      payload: row.payload,
    });
    if (extraction.status === "event") bucket.events.push(extraction.event);
    if (extraction.status === "malformed") bucket.malformed += 1;
    grouped.set(row.amoLeadId, bucket);
  }
  return grouped;
}

function toLeadUpsert(lead: NormalizedLead): NormalizedLeadWrite["lead"] {
  return {
    accountId: lead.accountId,
    amoLeadId: lead.amoLeadId,
    pipelineId: lead.pipelineId,
    currentStatusId: lead.currentStatusId,
    currentResponsibleUserId: lead.currentResponsibleUserId,
    name: lead.name,
    priceRub: lead.priceRub,
    createdAt: new Date(lead.createdAt),
    createdDate: lead.createdDate,
    sourceUpdatedAt: new Date(lead.sourceUpdatedAt),
    normalizedChannel: lead.normalizedChannel,
    channelRuleId: lead.channelRuleId,
    normalizationConfigId: lead.normalizationConfigId,
    amoUrl: lead.amoUrl,
    isDeleted: lead.isDeleted,
  };
}

/**
 * Normalizes one successful sync run: current snapshots, derived timelines,
 * milestones and quality issues are written in a single transaction, and raw
 * pages are never edited (SPEC M5.5).
 */
export async function normalizeSyncRun(
  deps: NormalizeSyncRunDeps,
  syncRunId: string,
): Promise<NormalizeRunResult> {
  const now = deps.now?.() ?? new Date();
  const run = await deps.repository.loadRun(syncRunId);
  if (!run) throw new AppError("E_NOT_FOUND", 404);
  if (run.status !== "success") throw new AppError("E_CONFLICT", 409);

  const config = await deps.loadActiveConfig(run.connectionId);
  if (!config) throw new AppError("E_CONFLICT", 409);

  const [statusSnapshots, userSnapshots, rawLeads] = await Promise.all([
    deps.repository.listRunEntities(syncRunId, "status"),
    deps.repository.listRunEntities(syncRunId, "user"),
    deps.repository.listRunLeads(syncRunId),
  ]);

  const statuses = planPipelineStatuses(run.accountId, config, statusSnapshots);
  const context = {
    accountId: run.accountId,
    config: {
      id: config.id,
      pipelineId: config.pipelineId,
      wonStatusId: config.wonStatusId,
      sourceFieldId: config.validation.sourceFieldFound ? config.sourceFieldId : null,
    },
    channelRules: toChannelRules(config),
    pipelineStatusIds: statuses.statusIds,
    normalizedAt: now.toISOString(),
  };

  const normalized: NormalizedLead[] = [];
  const excludedLeadIds: number[] = [];
  const snapshotIssues: (QualityIssueWrite & { amoLeadId: number | null })[] = [];
  let leadsRejected = 0;

  for (const rawLead of rawLeads) {
    const result = normalizeLead(rawLead.payload, context);
    for (const issue of result.issues) {
      snapshotIssues.push({
        accountId: issue.accountId,
        amoLeadId: issue.amoLeadId,
        syncRunId,
        code: issue.code,
        severity: issue.severity,
        safeDetails: issue.safeDetails,
      });
    }
    if (result.status === "normalized") {
      normalized.push(result.lead);
      continue;
    }
    if (result.status === "excluded") {
      excludedLeadIds.push(rawLead.amoLeadId);
      continue;
    }
    leadsRejected += 1;
  }

  // A lead that is already stored and has left the configured pipeline keeps
  // its history — nothing is deleted from the normalized layer
  // (METRICS_CATALOG section 11) — but its issue is escalated to blocking so
  // the stale row cannot reach a published report unnoticed.
  const storedExcludedLeadIds = await deps.repository.listStoredLeadIds(
    run.accountId,
    excludedLeadIds,
  );
  const storedExcluded = new Set(storedExcludedLeadIds);
  const issues: QualityIssueWrite[] = snapshotIssues.map((issue) =>
    issue.code === "out_of_scope_pipeline"
    && issue.amoLeadId !== null
    && storedExcluded.has(issue.amoLeadId)
      ? { ...issue, severity: "blocking" as LeadQualitySeverity, safeDetails: {
          ...(issue.safeDetails as Record<string, string | number>),
          stored: 1,
        } }
      : issue,
  );

  const eventRows = await deps.repository.listLeadEvents(
    run.accountId,
    normalized.map((lead) => lead.amoLeadId),
  );
  const grouped = groupLeadEvents(eventRows);
  const snapshotAt = run.snapshotAt.toISOString();

  let malformedEvents = 0;
  const leadWrites: NormalizedLeadWrite[] = [];
  for (const lead of normalized) {
    const leadEvents = grouped.get(lead.amoLeadId) ?? { events: [], malformed: 0 };
    const history = buildLeadHistory({
      accountId: lead.accountId,
      amoLeadId: lead.amoLeadId,
      events: leadEvents.events,
      applicationStatusId: config.applicationStatusId,
      wonStatusId: config.wonStatusId,
      currentStatusId: lead.currentStatusId,
      currentResponsibleUserId: lead.currentResponsibleUserId,
      pipelineStatuses: statuses.order,
      snapshotAt,
    });
    for (const issue of history.issues) {
      issues.push({
        accountId: issue.accountId,
        amoLeadId: issue.amoLeadId,
        syncRunId,
        code: issue.code,
        severity: issue.severity,
        safeDetails: issue.safeDetails,
      });
    }
    if (leadEvents.malformed > 0) {
      malformedEvents += leadEvents.malformed;
      issues.push({
        accountId: lead.accountId,
        amoLeadId: lead.amoLeadId,
        syncRunId,
        code: "malformed_event_payload",
        severity: HISTORY_ISSUE_SEVERITY.malformed_event_payload as LeadQualitySeverity,
        safeDetails: { count: leadEvents.malformed },
      });
    }
    leadWrites.push({
      lead: toLeadUpsert(lead),
      stageEvents: history.stageEvents.map((event) => ({
        accountId: lead.accountId,
        amoEventId: event.amoEventId,
        amoLeadId: lead.amoLeadId,
        fromStatusId: event.fromStatusId,
        toStatusId: event.toStatusId,
        responsibleUserId: event.responsibleUserId,
        occurredAt: new Date(event.occurredAt),
      })),
      responsibleEvents: history.responsibleEvents.map((event) => ({
        accountId: lead.accountId,
        amoEventId: event.amoEventId,
        amoLeadId: lead.amoLeadId,
        fromUserId: event.fromUserId,
        toUserId: event.toUserId,
        occurredAt: new Date(event.occurredAt),
      })),
      milestone: {
        accountId: lead.accountId,
        amoLeadId: lead.amoLeadId,
        applicationAt: history.milestones.applicationAt === null
          ? null
          : new Date(history.milestones.applicationAt),
        applicationResponsibleUserId: history.milestones.applicationResponsibleUserId,
        wonAt: history.milestones.wonAt === null
          ? null
          : new Date(history.milestones.wonAt),
        wonResponsibleUserId: history.milestones.wonResponsibleUserId,
        currentlyWon: history.milestones.currentlyWon,
        recalculatedAt: now,
      },
    });
  }

  const written = await deps.repository.apply({
    amoUsers: planAmoUsers(run.accountId, userSnapshots),
    pipelineStatuses: statuses.upserts,
    leads: leadWrites,
    issues,
  });

  return {
    syncRunId,
    leadsNormalized: written.leadsWritten,
    leadsExcluded: excludedLeadIds.length,
    leadsRejected,
    leadsOutOfScope: storedExcludedLeadIds.length,
    stageEventsWritten: written.stageEventsWritten,
    responsibleEventsWritten: written.responsibleEventsWritten,
    issuesOpened: written.issuesOpened,
    malformedEvents,
  };
}
