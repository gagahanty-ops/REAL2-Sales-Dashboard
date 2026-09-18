import { z } from "zod";

import { AppError } from "../errors.js";
import { parseIsoInstant } from "../time/moscow-date.js";
import type { LeadQualitySeverity } from "./normalize-lead.js";

/**
 * Timeline issue candidates. Task 4 owns the final acceptance policy; these
 * severities are the derivation default and complement the snapshot codes in
 * `LEAD_ISSUE_SEVERITY`.
 */
export const HISTORY_ISSUE_SEVERITY = {
  duplicate_event: "info",
  invalid_event_time: "blocking",
  malformed_event_payload: "warning",
  missing_stage_history: "blocking",
  stage_history_conflict: "warning",
} as const satisfies Record<string, LeadQualitySeverity>;

export type LeadHistoryIssueCode = keyof typeof HISTORY_ISSUE_SEVERITY;

/** Only fixed reason codes and numeric IDs; never names or source text. */
type SafeDetails = Readonly<Record<string, string | number>>;

export type LeadHistoryIssueCandidate = Readonly<{
  accountId: number;
  amoLeadId: number;
  code: LeadHistoryIssueCode;
  severity: LeadQualitySeverity;
  safeDetails: SafeDetails;
}>;

export type LeadHistoryEvent =
  | Readonly<{
      kind: "stage";
      amoEventId: string;
      /** ISO 8601 instant with an explicit zone. */
      occurredAt: string;
      fromStatusId: number | null;
      toStatusId: number;
    }>
  | Readonly<{
      kind: "responsible";
      amoEventId: string;
      occurredAt: string;
      fromUserId: number | null;
      toUserId: number | null;
    }>;

export type PipelineStatusOrder = Readonly<{
  statusId: number;
  sortOrder: number;
}>;

export type BuildLeadHistoryInput = Readonly<{
  accountId: number;
  amoLeadId: number;
  events: readonly LeadHistoryEvent[];
  applicationStatusId: number;
  wonStatusId: number;
  /** Current status of the newest confirmed snapshot. */
  currentStatusId: number;
  currentResponsibleUserId: number | null;
  /** Status order of the configured pipeline from the same sync run. */
  pipelineStatuses: readonly PipelineStatusOrder[];
  /** Instant the snapshot was taken; the open stage is measured against it. */
  snapshotAt: string;
}>;

export type LeadStageEventRecord = Readonly<{
  amoEventId: string;
  fromStatusId: number | null;
  toStatusId: number;
  responsibleUserId: number | null;
  occurredAt: string;
}>;

export type LeadResponsibleEventRecord = Readonly<{
  amoEventId: string;
  fromUserId: number | null;
  toUserId: number | null;
  occurredAt: string;
}>;

export type LeadMilestones = Readonly<{
  applicationAt: string | null;
  applicationResponsibleUserId: number | null;
  wonAt: string | null;
  wonResponsibleUserId: number | null;
  currentlyWon: boolean;
}>;

export type LeadStageStay = Readonly<{
  statusId: number;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number | null;
  ageSeconds: number | null;
}>;

export type LeadResponsibility = Readonly<{
  atCreation: number | null;
  atApplication: number | null;
  atWon: number | null;
  current: number | null;
}>;

export type LeadHistoryResult = Readonly<{
  orderedEventIds: readonly string[];
  stageEvents: readonly LeadStageEventRecord[];
  responsibleEvents: readonly LeadResponsibleEventRecord[];
  milestones: LeadMilestones;
  stageStays: readonly LeadStageStay[];
  responsibility: LeadResponsibility;
  issues: readonly LeadHistoryIssueCandidate[];
}>;

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const amoEventId = z.string().min(1).max(128);

const eventSchema = z.union([
  z.object({
    kind: z.literal("stage"),
    amoEventId,
    occurredAt: z.string().min(1),
    fromStatusId: positiveId.nullable(),
    toStatusId: positiveId,
  }),
  z.object({
    kind: z.literal("responsible"),
    amoEventId,
    occurredAt: z.string().min(1),
    fromUserId: positiveId.nullable(),
    toUserId: positiveId.nullable(),
  }),
]);

const inputSchema = z.object({
  accountId: positiveId,
  amoLeadId: positiveId,
  events: z.array(eventSchema),
  applicationStatusId: positiveId,
  wonStatusId: positiveId,
  currentStatusId: positiveId,
  currentResponsibleUserId: positiveId.nullable(),
  pipelineStatuses: z.array(
    z.object({
      statusId: positiveId,
      sortOrder: z.number().int().safe(),
    }),
  ),
  snapshotAt: z.string().min(1),
});

type OrderedEvent = Readonly<{ event: LeadHistoryEvent; occurredAt: string }>;

function compareOrdered(left: OrderedEvent, right: OrderedEvent): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt < right.occurredAt ? -1 : 1;
  }
  if (left.event.amoEventId === right.event.amoEventId) return 0;
  return left.event.amoEventId < right.event.amoEventId ? -1 : 1;
}

function elapsedSeconds(fromIso: string, toIso: string): number {
  const millis = Date.parse(toIso) - Date.parse(fromIso);
  return Math.max(0, Math.round(millis / 1_000));
}

type IssueDraft = Readonly<{ count: number; details: SafeDetails }>;

function collectIssues(
  accountId: number,
  amoLeadId: number,
  drafts: ReadonlyMap<LeadHistoryIssueCode, IssueDraft>,
): readonly LeadHistoryIssueCandidate[] {
  return [...drafts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([code, draft]) => ({
      accountId,
      amoLeadId,
      code,
      severity: HISTORY_ISSUE_SEVERITY[code] as LeadQualitySeverity,
      safeDetails: { count: draft.count, ...draft.details },
    }));
}

/**
 * Derives the ordered timelines, milestones and stage durations of one lead.
 * Pure and total: identical input always produces identical output, and no
 * milestone is ever invented from the current status alone (SPEC M5.5).
 */
export function buildLeadHistory(input: BuildLeadHistoryInput): LeadHistoryResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("E_VALIDATION", 422);
  if (input.applicationStatusId === input.wonStatusId) {
    throw new AppError("E_VALIDATION", 422);
  }
  const snapshotInstant = parseIsoInstant(input.snapshotAt);
  if (snapshotInstant === null) throw new AppError("E_VALIDATION", 422);
  const snapshotAt = snapshotInstant.toISOString();

  const issues = new Map<LeadHistoryIssueCode, IssueDraft>();
  const raise = (code: LeadHistoryIssueCode, details: SafeDetails = {}): void => {
    const previous = issues.get(code);
    issues.set(code, {
      count: (previous?.count ?? 0) + 1,
      details: { ...previous?.details, ...details },
    });
  };

  const ordered: OrderedEvent[] = [];
  for (const event of input.events) {
    const instant = parseIsoInstant(event.occurredAt);
    if (instant === null) {
      raise("invalid_event_time");
      continue;
    }
    ordered.push({ event, occurredAt: instant.toISOString() });
  }
  ordered.sort(compareOrdered);

  const seenEventIds = new Set<string>();
  const unique: OrderedEvent[] = [];
  for (const entry of ordered) {
    if (seenEventIds.has(entry.event.amoEventId)) {
      raise("duplicate_event");
      continue;
    }
    seenEventIds.add(entry.event.amoEventId);
    unique.push(entry);
  }

  const responsibleEvents: LeadResponsibleEventRecord[] = unique
    .filter((entry) => entry.event.kind === "responsible")
    .map((entry) => {
      const event = entry.event as Extract<LeadHistoryEvent, { kind: "responsible" }>;
      return {
        amoEventId: event.amoEventId,
        fromUserId: event.fromUserId,
        toUserId: event.toUserId,
        occurredAt: entry.occurredAt,
      };
    });

  const responsibleAtCreation =
    responsibleEvents.length > 0
      ? (responsibleEvents[0]?.fromUserId ?? null)
      : input.currentResponsibleUserId;

  const responsibleAt = (instant: string): number | null => {
    let current = responsibleAtCreation;
    for (const event of responsibleEvents) {
      if (event.occurredAt > instant) break;
      current = event.toUserId;
    }
    return current;
  };

  const stageEntries = unique.filter((entry) => entry.event.kind === "stage");
  const stageEvents: LeadStageEventRecord[] = [];
  let previousToStatusId: number | null = null;
  let previousOccurredAt: string | null = null;
  for (const entry of stageEntries) {
    const event = entry.event as Extract<LeadHistoryEvent, { kind: "stage" }>;
    const brokenChain =
      previousToStatusId !== null
      && event.fromStatusId !== null
      && event.fromStatusId !== previousToStatusId;
    const contradictoryInstant =
      previousOccurredAt === entry.occurredAt && previousToStatusId !== event.toStatusId;
    if (brokenChain || contradictoryInstant) {
      raise("stage_history_conflict", { amoLeadId: input.amoLeadId });
    }
    stageEvents.push({
      amoEventId: event.amoEventId,
      fromStatusId: event.fromStatusId,
      toStatusId: event.toStatusId,
      responsibleUserId: responsibleAt(entry.occurredAt),
      occurredAt: entry.occurredAt,
    });
    previousToStatusId = event.toStatusId;
    previousOccurredAt = entry.occurredAt;
  }

  const applicationEvent = stageEvents.find(
    (event) => event.toStatusId === input.applicationStatusId,
  );
  const wonEvent = stageEvents.find((event) => event.toStatusId === input.wonStatusId);
  const currentlyWon = input.currentStatusId === input.wonStatusId;

  const sortOrderOf = (statusId: number): number | null =>
    input.pipelineStatuses.find((status) => status.statusId === statusId)?.sortOrder
    ?? null;
  const currentSortOrder = sortOrderOf(input.currentStatusId);
  const applicationSortOrder = sortOrderOf(input.applicationStatusId);
  const reachedApplicationStage =
    currentSortOrder !== null
    && applicationSortOrder !== null
    && currentSortOrder >= applicationSortOrder;

  if (currentlyWon && !wonEvent) {
    raise("missing_stage_history", { currentStatusId: input.currentStatusId });
  }
  if (!applicationEvent && reachedApplicationStage) {
    raise("missing_stage_history", { currentStatusId: input.currentStatusId });
  }

  const stageStays: LeadStageStay[] = stageEvents.map((event, index) => {
    const next = stageEvents[index + 1];
    if (next) {
      return {
        statusId: event.toStatusId,
        enteredAt: event.occurredAt,
        exitedAt: next.occurredAt,
        durationSeconds: elapsedSeconds(event.occurredAt, next.occurredAt),
        ageSeconds: null,
      };
    }
    return {
      statusId: event.toStatusId,
      enteredAt: event.occurredAt,
      exitedAt: null,
      durationSeconds: null,
      ageSeconds: elapsedSeconds(event.occurredAt, snapshotAt),
    };
  });

  return {
    orderedEventIds: unique.map((entry) => entry.event.amoEventId),
    stageEvents,
    responsibleEvents,
    milestones: {
      applicationAt: applicationEvent?.occurredAt ?? null,
      applicationResponsibleUserId: applicationEvent?.responsibleUserId ?? null,
      wonAt: wonEvent?.occurredAt ?? null,
      wonResponsibleUserId: wonEvent?.responsibleUserId ?? null,
      currentlyWon,
    },
    stageStays,
    responsibility: {
      atCreation: responsibleAtCreation,
      atApplication: applicationEvent?.responsibleUserId ?? null,
      atWon: wonEvent?.responsibleUserId ?? null,
      current: input.currentResponsibleUserId,
    },
    issues: collectIssues(input.accountId, input.amoLeadId, issues),
  };
}

export type RawHistoryEvent = Readonly<{
  amoEventId: string;
  eventType: string;
  /** Canonical instant of `raw_amo_events.event_at`. */
  occurredAt: string;
  payload: unknown;
}>;

export type HistoryEventExtraction =
  | Readonly<{ status: "event"; event: LeadHistoryEvent }>
  /** Not a timeline event type, or not a lead event. */
  | Readonly<{ status: "ignored" }>
  /** A timeline event type whose payload cannot be read. */
  | Readonly<{ status: "malformed" }>;

const STAGE_EVENT_TYPE = "lead_status_changed";
const RESPONSIBLE_EVENT_TYPE = "entity_responsible_changed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

type ReadIdResult = Readonly<{ ok: true; id: number | null }> | Readonly<{ ok: false }>;

/** Reads `[{ <key>: { id } }]`; an empty list means "no value", not an error. */
function readEmbeddedId(value: unknown, key: string): ReadIdResult {
  if (value === undefined || value === null) return { ok: true, id: null };
  if (!Array.isArray(value)) return { ok: false };
  const [first] = value;
  if (first === undefined) return { ok: true, id: null };
  if (!isRecord(first) || !isRecord(first[key])) return { ok: false };
  const id = (first[key] as Record<string, unknown>).id;
  if (!isPositiveSafeInteger(id)) return { ok: false };
  return { ok: true, id };
}

/**
 * Turns one stored raw amoCRM event into a timeline event. Unknown event types
 * are ignored; a timeline type with an unusable payload is reported so the run
 * can open `malformed_event_payload` instead of losing the change silently.
 */
export function extractHistoryEvent(input: RawHistoryEvent): HistoryEventExtraction {
  if (input.eventType !== STAGE_EVENT_TYPE && input.eventType !== RESPONSIBLE_EVENT_TYPE) {
    return { status: "ignored" };
  }
  if (!isRecord(input.payload)) return { status: "malformed" };
  const entityType = input.payload.entity_type;
  if (entityType !== undefined && entityType !== "lead") return { status: "ignored" };

  if (input.eventType === STAGE_EVENT_TYPE) {
    const after = readEmbeddedId(input.payload.value_after, "lead_status");
    const before = readEmbeddedId(input.payload.value_before, "lead_status");
    if (!after.ok || !before.ok || after.id === null) return { status: "malformed" };
    return {
      status: "event",
      event: {
        kind: "stage",
        amoEventId: input.amoEventId,
        occurredAt: input.occurredAt,
        fromStatusId: before.id,
        toStatusId: after.id,
      },
    };
  }

  const after = readEmbeddedId(input.payload.value_after, "responsible_user");
  const before = readEmbeddedId(input.payload.value_before, "responsible_user");
  if (!after.ok || !before.ok) return { status: "malformed" };
  return {
    status: "event",
    event: {
      kind: "responsible",
      amoEventId: input.amoEventId,
      occurredAt: input.occurredAt,
      fromUserId: before.id,
      toUserId: after.id,
    },
  };
}
