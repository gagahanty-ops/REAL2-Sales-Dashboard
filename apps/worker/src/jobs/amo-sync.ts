import { createHash, randomUUID } from "node:crypto";

import {
  appendAmoApiAudit,
  appendRawPage,
  closeDbClient,
  createServiceWorkerDbClient,
  finishSyncRun,
  getActivePipelineConfig,
  getCurrentSafeAmoConnectionStatus,
  getPreviousFullLeadCount,
  getSyncCursors,
  getSystemControl,
  quarantineRawPage,
  startSyncRun,
  withSyncAdvisoryLock,
  type Database,
} from "@real2/db";
import type {
  AmoApiAuditInput,
  AppendRawPageInput,
  ClaimedSyncWork,
  RawAmoEventInput,
  RawAmoObjectInput,
  SyncCounts,
  SyncCursorPosition,
  SyncKind,
  SyncLockFence,
  SyncOutcome,
  SyncStream,
} from "@real2/db";
import {
  AppError,
  parseServerEnv,
  type AppErrorCode,
  type ServerEnv,
} from "@real2/domain";
import {
  amoFetch,
  amoAccountResponseSchema,
  amoEventsResponseSchema,
  amoLeadsResponseSchema,
  amoPipelinesResponseSchema,
  amoStatusesResponseSchema,
  amoUsersResponseSchema,
  createAmoTokenProvider,
  decodeTokenEncryptionKey,
  refreshConnection,
  type AmoAccountResponse,
  type AmoEvent,
  type AmoEventsResponse,
  type AmoLead,
  type AmoLeadsResponse,
  type AmoPipeline,
  type AmoPipelinesResponse,
  type AmoStatus,
  type AmoStatusesResponse,
  type AmoTokenProvider,
  type AmoUser,
  type AmoUsersResponse,
} from "@real2/integrations";
import type { JSONValue } from "postgres";
import { z } from "zod";

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000, 27_000, 60_000] as const;
const OVERLAP_MS = 10 * 60_000;
const MAX_COUNT_DROP_RATIO = 0.05;

export type Clock = Readonly<{
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  random(): number;
}>;

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random: () => Math.random(),
};

export type ActiveSyncConnection = Readonly<{
  id: string;
  accountId: number;
  baseUrl: string;
}>;

export type ActiveSyncConfig = Readonly<{
  id: string;
  pipelineId: number;
}>;

export type SyncCursorSnapshot = Partial<
  Record<SyncStream, SyncCursorPosition>
>;

export type SyncRunResult =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{
      status: "success" | "partial" | "failed";
      runId: string;
      traceId: string;
      errorCode?: AppErrorCode | string | null;
      errorSummary?: string | null;
    }>
  | Readonly<{ status: "locked"; code: "E_SYNC_LOCKED" }>;

export type SyncTransportRequest<T> = Readonly<{
  url: string;
  runId: string;
  traceId: string;
  attempt: number;
  tokenProvider: AmoTokenProvider;
  schema: z.ZodType<T>;
  fence: SyncLockFence;
  audit(input: AmoApiAuditInput): Promise<void>;
}>;

export type StartedSyncRun = Readonly<{ id: string; traceId: string }>;

export type RunSyncOptions = Readonly<{
  traceId?: string;
  correlationTraceId?: string | null;
  requestedBy?: string | null;
}>;

export type AmoSyncDependencies = Readonly<{
  envEnabled: boolean;
  controls: Readonly<{ isSyncEnabled(): Promise<boolean> }>;
  connections: Readonly<{ getActive(): Promise<ActiveSyncConnection | null> }>;
  configs: Readonly<{
    getActive(connectionId: string): Promise<ActiveSyncConfig | null>;
  }>;
  locks: Readonly<{
    withSyncLock<T>(
      connectionId: string,
      action: (fence: SyncLockFence) => Promise<T>,
    ): Promise<T>;
  }>;
  cursors: Readonly<{
    get(connectionId: string): Promise<SyncCursorSnapshot>;
  }>;
  runs: Readonly<{
    start(input: {
      kind: SyncKind;
      connectionId: string;
      configId: string;
      traceId: string;
      correlationTraceId?: string | null;
      startedAt: Date;
      createdBy?: string | null;
    }): Promise<StartedSyncRun>;
    finish(runId: string, outcome: SyncOutcome, finishedAt: Date): Promise<void>;
  }>;
  raw: Readonly<{
    appendPage(input: AppendRawPageInput): Promise<void>;
    quarantinePage(input: {
      syncRunId: string;
      stream: SyncStream;
      pageNumber: number;
      reasonCode: string;
      payload: JSONValue;
      payloadSha256: string;
      receivedAt: Date;
    }): Promise<void>;
  }>;
  transport: Readonly<{
    requestPage<T>(request: SyncTransportRequest<T>): Promise<unknown>;
  }>;
  tokens: Readonly<{
    createProvider(
      connectionId: string,
      context: Readonly<{
        runId: string;
        traceId: string;
        clock: Clock;
        fence: SyncLockFence;
      }>,
    ): AmoTokenProvider;
    refresh(
      connectionId: string,
      now: Date,
      context: Readonly<{ runId: string; traceId: string; fence: SyncLockFence }>,
    ): Promise<string>;
  }>;
  audit?: Readonly<{
    append(input: AmoApiAuditInput): Promise<void>;
  }>;
  reconciliation: Readonly<{
    previousFullLeadCount(connectionId: string): Promise<number | null>;
  }>;
  alerts?: Readonly<{
    critical(input: Readonly<{ runId: string; code: string; summary: string }>): Promise<void>;
  }>;
  traceId?: () => string;
}>;

type MutableCounts = {
  pagesRead: number;
  leadsRead: number;
  eventsRead: number;
  usersRead: number;
  retries: number;
};

type SyncFailure = Error & {
  code?: AppErrorCode;
  responseStatus?: number;
  forceStatus?: "partial" | "failed";
};

type RunContext = {
  connection: ActiveSyncConnection;
  config: ActiveSyncConfig;
  run: StartedSyncRun;
  clock: Clock;
  counts: MutableCounts;
  tokenProvider: AmoTokenProvider;
  pageHashes: string[];
  distinctLeadIds: Set<number>;
  fence: SyncLockFence;
  nextCursors: SyncCursorSnapshot;
  nextPageNumber: Record<SyncStream, number>;
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asJsonValue(value: unknown): JSONValue {
  return value as JSONValue;
}

function toDate(unixSeconds: number): Date {
  return new Date(unixSeconds * 1_000);
}

function countsSnapshot(counts: MutableCounts): SyncCounts {
  return { ...counts };
}

function appendQuery(url: string, entries: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(entries)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("responseStatus" in error)) {
    return undefined;
  }
  const status = (error as { responseStatus?: unknown }).responseStatus;
  return typeof status === "number" ? status : undefined;
}

function errorCode(error: unknown): AppErrorCode {
  if (error instanceof AppError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("E_")) {
      return code as AppErrorCode;
    }
  }
  return "E_AMO_UPSTREAM";
}

function fail(
  code: AppErrorCode,
  message: string,
  forceStatus?: "partial" | "failed",
): SyncFailure {
  return Object.assign(new AppError(code, code === "E_SYNC_LOCKED" ? 409 : 502), {
    message,
    ...(forceStatus ? { forceStatus } : {}),
  });
}

function nextCursor(
  current: SyncCursorPosition | undefined,
  candidateTime: Date,
  candidateExternalId: string,
): SyncCursorPosition {
  if (!current?.cursorTime) {
    return { cursorTime: candidateTime, cursorExternalId: candidateExternalId };
  }
  const difference = candidateTime.getTime() - current.cursorTime.getTime();
  if (
    difference > 0 ||
    (difference === 0 &&
      candidateExternalId > (current.cursorExternalId ?? ""))
  ) {
    return { cursorTime: candidateTime, cursorExternalId: candidateExternalId };
  }
  return current;
}

async function requestWithRetry<T>(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  url: string,
  schema: z.ZodType<T>,
): Promise<unknown> {
  let refreshed = false;
  let retryIndex = 0;
  let attempt = 1;

  while (true) {
    try {
      await context.fence.assertOwned();
      return await dependencies.transport.requestPage({
        url,
        runId: context.run.id,
        traceId: context.run.traceId,
        attempt,
        tokenProvider: context.tokenProvider,
        schema,
        fence: context.fence,
        audit: async (input) => dependencies.audit?.append(input),
      });
    } catch (error) {
      const status = responseStatus(error);
      const code = errorCode(error);
      if (!refreshed && (status === 401 || code === "E_AMO_AUTH")) {
        refreshed = true;
        context.counts.retries += 1;
        await context.fence.assertOwned();
        await dependencies.tokens.refresh(
          context.connection.id,
          context.clock.now(),
          { runId: context.run.id, traceId: context.run.traceId, fence: context.fence },
        );
        attempt += 1;
        continue;
      }

      const retryable =
        status === 429 ||
        (status !== undefined && status >= 500 && status <= 599) ||
        code === "E_AMO_RATE_LIMIT" ||
        (code === "E_AMO_UPSTREAM" && status === undefined);
      if (!retryable || retryIndex >= RETRY_DELAYS_MS.length) throw error;

      const baseDelay = RETRY_DELAYS_MS[retryIndex]!;
      const jitter = Math.round(baseDelay * 0.2 * context.clock.random());
      context.counts.retries += 1;
      retryIndex += 1;
      attempt += 1;
      await context.clock.sleep(baseDelay + jitter);
    }
  }
}

async function appendValidatedPage(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  stream: SyncStream,
  payload: unknown,
  objects: readonly RawAmoObjectInput[],
  events: readonly RawAmoEventInput[],
): Promise<void> {
  const payloadSha256 = sha256(payload);
  context.pageHashes.push(payloadSha256);
  const pageNumber = context.nextPageNumber[stream]++;
  await context.fence.assertOwned();
  await dependencies.raw.appendPage({
    syncRunId: context.run.id,
    stream,
    pageNumber,
    itemCount: objects.length + events.length,
    payloadSha256,
    objects,
    events,
    receivedAt: context.clock.now(),
  });
  context.counts.pagesRead += 1;
}

async function quarantineInvalidPage(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  stream: SyncStream,
  payload: unknown,
): Promise<never> {
  const payloadSha256 = sha256(payload);
  const pageNumber = context.nextPageNumber[stream]++;
  await context.fence.assertOwned();
  await dependencies.raw.quarantinePage({
    syncRunId: context.run.id,
    stream,
    pageNumber,
    reasonCode: "E_SCHEMA_INVALID",
    payload: asJsonValue(payload),
    payloadSha256,
    receivedAt: context.clock.now(),
  });
  context.counts.pagesRead += 1;
  throw fail("E_SYNC_PARTIAL", "amoCRM page schema validation failed", "partial");
}

async function loadPage<T>(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  url: string,
  schema: z.ZodType<T>,
  stream: SyncStream,
): Promise<T> {
  const payload = await requestWithRetry(
    dependencies,
    context,
    url,
    schema,
  );
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return quarantineInvalidPage(dependencies, context, stream, payload);
  }
  return parsed.data;
}

async function paginate<
  T extends {
    _links?: { next?: { href: string } | undefined } | undefined;
  },
>(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  input: {
    url: string;
    schema: z.ZodType<T>;
    stream: SyncStream;
    map(payload: T): {
      objects: readonly RawAmoObjectInput[];
      events: readonly RawAmoEventInput[];
    };
  },
): Promise<void> {
  const seenChecksums = new Set<string>();
  const seenLogicalChecksums = new Set<string>();
  let url: string | undefined = input.url;

  while (url) {
    const payload: T = await loadPage<T>(
      dependencies,
      context,
      url,
      input.schema,
      input.stream,
    );
    const payloadSha256 = sha256(payload);
    if (seenChecksums.has(payloadSha256)) {
      throw fail("E_AMO_UPSTREAM", "amoCRM pagination loop detected", "failed");
    }
    seenChecksums.add(payloadSha256);
    const mapped = input.map(payload);
    // Envelope metadata (timestamps, paging markers, and next links) can
    // change while amoCRM repeats the same logical page. Detect that loop
    // before appending a second copy of its objects/events.
    const logicalChecksum = sha256({
      stream: input.stream,
      objects: mapped.objects.map((object) => [object.entityType, object.externalId]),
      events: mapped.events.map((event) => event.amoEventId),
    });
    if (seenLogicalChecksums.has(logicalChecksum)) {
      throw fail("E_AMO_UPSTREAM", "amoCRM logical pagination loop detected", "failed");
    }
    seenLogicalChecksums.add(logicalChecksum);
    await appendValidatedPage(
      dependencies,
      context,
      input.stream,
      payload,
      mapped.objects,
      mapped.events,
    );
    url = payload._links?.next?.href;
  }
}

function objectInput(
  accountId: number,
  entityType: RawAmoObjectInput["entityType"],
  externalId: number,
  payload: object,
  sourceUpdatedAt?: Date | null,
): RawAmoObjectInput {
  return {
    accountId,
    entityType,
    externalId,
    ...(sourceUpdatedAt !== undefined ? { sourceUpdatedAt } : {}),
    payload: asJsonValue(payload),
    payloadSha256: sha256(payload),
  };
}

async function ingestMetadata(
  dependencies: AmoSyncDependencies,
  context: RunContext,
): Promise<void> {
  const accountUrl = `${context.connection.baseUrl}/api/v4/account`;
  const account = await loadPage(
    dependencies,
    context,
    accountUrl,
    amoAccountResponseSchema,
    "metadata",
  );
  await appendValidatedPage(
    dependencies,
    context,
    "metadata",
    account,
    [objectInput(account.id, "account", account.id, account)],
    [],
  );

  await paginate<AmoPipelinesResponse>(dependencies, context, {
    url: `${context.connection.baseUrl}/api/v4/leads/pipelines`,
    schema: amoPipelinesResponseSchema,
    stream: "metadata",
    map: (payload) => ({
      objects: payload._embedded.pipelines.map((pipeline: AmoPipeline) =>
        objectInput(account.id, "pipeline", pipeline.id, pipeline),
      ),
      events: [],
    }),
  });

  await paginate<AmoStatusesResponse>(dependencies, context, {
    url: `${context.connection.baseUrl}/api/v4/leads/pipelines/${context.config.pipelineId}/statuses`,
    schema: amoStatusesResponseSchema,
    stream: "metadata",
    map: (payload) => ({
      objects: payload._embedded.statuses.map((status: AmoStatus) =>
        objectInput(account.id, "status", status.id, status),
      ),
      events: [],
    }),
  });
}

async function ingestUsers(
  dependencies: AmoSyncDependencies,
  context: RunContext,
): Promise<void> {
  await paginate<AmoUsersResponse>(dependencies, context, {
    url: `${context.connection.baseUrl}/api/v4/users`,
    schema: amoUsersResponseSchema,
    stream: "users",
    map: (payload) => {
      const users = payload._embedded.users;
      context.counts.usersRead += users.length;
      return {
        objects: users.map((user: AmoUser) =>
          objectInput(context.connection.accountId, "user", user.id, user),
        ),
        events: [],
      };
    },
  });
}

async function ingestEvents(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  incremental: boolean,
): Promise<void> {
  let url = `${context.connection.baseUrl}/api/v4/events`;
  const existing = context.nextCursors.events;
  if (incremental && existing?.cursorTime) {
    url = appendQuery(url, {
      "filter[created_at][from]": String(
        Math.floor((existing.cursorTime.getTime() - OVERLAP_MS) / 1_000),
      ),
    });
  }
  await paginate<AmoEventsResponse>(dependencies, context, {
    url,
    schema: amoEventsResponseSchema,
    stream: "events",
    map: (payload) => {
      const events = payload._embedded.events;
      context.counts.eventsRead += events.length;
      for (const event of events) {
        context.nextCursors.events = nextCursor(
          context.nextCursors.events,
          toDate(event.created_at),
          event.id,
        );
      }
      return {
        objects: [],
        events: events.map((event: AmoEvent) => ({
          accountId: event.account_id,
          amoEventId: event.id,
          amoLeadId: event.entity_type === "lead" ? event.entity_id : null,
          eventType: event.type,
          eventAt: toDate(event.created_at),
          payload: asJsonValue(event),
          payloadSha256: sha256(event),
        })),
      };
    },
  });
}

async function ingestLeads(
  dependencies: AmoSyncDependencies,
  context: RunContext,
  incremental: boolean,
): Promise<void> {
  let url = appendQuery(`${context.connection.baseUrl}/api/v4/leads`, {
    "filter[pipeline_id]": String(context.config.pipelineId),
  });
  const existing = context.nextCursors.leads;
  if (incremental && existing?.cursorTime) {
    url = appendQuery(url, {
      "filter[updated_at][from]": String(
        Math.floor((existing.cursorTime.getTime() - OVERLAP_MS) / 1_000),
      ),
    });
  }
  await paginate<AmoLeadsResponse>(dependencies, context, {
    url,
    schema: amoLeadsResponseSchema,
    stream: "leads",
    map: (payload) => {
      const leads = payload._embedded.leads;
      for (const lead of leads) {
        context.distinctLeadIds.add(lead.id);
        context.nextCursors.leads = nextCursor(
          context.nextCursors.leads,
          toDate(lead.updated_at),
          String(lead.id),
        );
      }
      return {
        objects: leads.map((lead: AmoLead) =>
          objectInput(
            lead.account_id,
            "lead",
            lead.id,
            lead,
            toDate(lead.updated_at),
          ),
        ),
        events: [],
      };
    },
  });
}

async function executeLockedSync(
  dependencies: AmoSyncDependencies,
  kind: SyncKind,
  clock: Clock,
  connection: ActiveSyncConnection,
  fence: SyncLockFence,
  options: RunSyncOptions,
): Promise<SyncRunResult> {
  const traceId = options.traceId ?? dependencies.traceId?.() ?? randomUUID();
  let run: StartedSyncRun | undefined;
  let context: RunContext | undefined;
  const counts: MutableCounts = {
    pagesRead: 0,
    leadsRead: 0,
    eventsRead: 0,
    usersRead: 0,
    retries: 0,
  };
  const incremental = kind === "incremental";

  try {
    const config = await dependencies.configs.getActive(connection.id);
    if (!config) throw new AppError("E_CONFIG_INCOMPLETE", 422);
    run = await dependencies.runs.start({
      kind,
      connectionId: connection.id,
      configId: config.id,
      traceId,
      correlationTraceId: options.correlationTraceId ?? null,
      startedAt: clock.now(),
      createdBy: options.requestedBy ?? null,
    });
    context = {
      connection, config, run, clock, counts,
      tokenProvider: dependencies.tokens.createProvider(connection.id, {
        runId: run.id, traceId: run.traceId, clock, fence,
      }),
      pageHashes: [],
      distinctLeadIds: new Set<number>(),
      fence,
      nextCursors: await dependencies.cursors.get(connection.id),
      nextPageNumber: { metadata: 1, users: 1, events: 1, leads: 1 },
    };
    await ingestMetadata(dependencies, context);
    await ingestUsers(dependencies, context);
    await ingestEvents(dependencies, context, incremental);
    await ingestLeads(dependencies, context, incremental);

    if (!incremental) {
      const previousCount = await dependencies.reconciliation.previousFullLeadCount(
        connection.id,
      );
      if (
        previousCount !== null &&
        previousCount > 0 &&
        context.distinctLeadIds.size < previousCount * (1 - MAX_COUNT_DROP_RATIO)
      ) {
        throw fail(
          "E_DATA_QUALITY_BLOCK",
          "Full lead count dropped by more than five percent",
          "failed",
        );
      }
    }

    counts.leadsRead = context.distinctLeadIds.size;
    await fence.assertOwned();
    await dependencies.runs.finish(
      run.id,
      {
        status: "success",
        nextCursors: context.nextCursors,
        counts: countsSnapshot(counts),
        checksum: sha256(context.pageHashes),
      },
      clock.now(),
    );
    return { status: "success", runId: run.id, traceId: run.traceId };
  } catch (error) {
    // Nothing durable exists until the run has started. After that point every
    // setup, token, cursor, and ingest failure must seal the run.
    if (!run) throw error;
    if (errorCode(error) === "E_SYNC_FENCE_LOST") throw error;
    await fence.assertOwned();
    const forced = (error as SyncFailure).forceStatus;
    const status = forced ?? (counts.pagesRead > 0 ? "partial" : "failed");
    const code = errorCode(error);
    if (context) {
      counts.leadsRead = context.distinctLeadIds.size;
    }
    let safeError =
      code === "E_DATA_QUALITY_BLOCK"
        ? "Full lead count dropped by more than five percent"
        : code === "E_AMO_AUTH"
          ? "amoCRM authorization failed"
          : code === "E_SYNC_PARTIAL"
            ? "amoCRM returned an invalid page"
            : "amoCRM synchronization failed";
    if (code === "E_DATA_QUALITY_BLOCK") {
      try {
        await fence.assertOwned();
        await dependencies.alerts?.critical({
          runId: run.id,
          code,
          summary: "Full lead count dropped by more than five percent",
        });
      } catch (alertError) {
        if (errorCode(alertError) === "E_SYNC_FENCE_LOST") throw alertError;
        safeError = `${safeError}; critical alert delivery failed`;
      }
    }
    await fence.assertOwned();
    await dependencies.runs.finish(
      run.id,
      {
        status,
        safeError,
        errorCode: code,
        counts: countsSnapshot(counts),
        checksum:
          context && context.pageHashes.length > 0
            ? sha256(context.pageHashes)
            : null,
      },
      clock.now(),
    );
    return {
      status,
      runId: run.id,
      traceId: run.traceId,
      errorCode: code,
      errorSummary: safeError,
    };
  }
}

export function createAmoSyncRunner(dependencies: AmoSyncDependencies) {
  return async function runSyncWithDependencies(
    kind: SyncKind,
    clock: Clock = systemClock,
    options: RunSyncOptions = {},
  ): Promise<SyncRunResult> {
    if (!dependencies.envEnabled) return { kind: "disabled" };
    if (!(await dependencies.controls.isSyncEnabled())) {
      return { kind: "disabled" };
    }

    const connection = await dependencies.connections.getActive();
    if (!connection || !Number.isSafeInteger(connection.accountId)) {
      throw new AppError("E_AMO_AUTH", 502);
    }

    try {
      return await dependencies.locks.withSyncLock(connection.id, (fence) =>
        executeLockedSync(dependencies, kind, clock, connection, fence, options),
      );
    } catch (error) {
      if (errorCode(error) === "E_SYNC_LOCKED") {
        return { status: "locked", code: "E_SYNC_LOCKED" };
      }
      throw error;
    }
  };
}

export type SyncWorkQueueProcessor = Readonly<{
  now(): Date;
  claim(input: Readonly<{ now: Date; leaseMs: number }>): Promise<ClaimedSyncWork | null>;
  complete(input: {
    id: string;
    leaseToken: string;
    status: "done" | "failed";
    completedAt: Date;
    syncRunId?: string | null;
    errorCode?: AppErrorCode | string | null;
    errorSummary?: string | null;
  }): Promise<void>;
  run(kind: SyncKind, clock: Clock, options: RunSyncOptions): Promise<SyncRunResult>;
}>;

const QUEUE_LEASE_MS = 20 * 60_000;

export async function processSyncWorkQueue(
  processor: SyncWorkQueueProcessor,
): Promise<number> {
  const now = processor.now();
  const work = await processor.claim({ now, leaseMs: QUEUE_LEASE_MS });
  if (!work) return 0;

  try {
    const result = await processor.run(work.kind, systemClock, {
      correlationTraceId: work.traceId,
      requestedBy: work.requestedBy,
    });
    if ("runId" in result) {
      if (result.status !== "success") {
        await processor.complete({
          id: work.id,
          leaseToken: work.leaseToken,
          status: "failed",
          completedAt: processor.now(),
          syncRunId: result.runId,
          errorCode:
            result.errorCode ??
            (result.status === "partial" ? "E_SYNC_PARTIAL" : "E_INTERNAL"),
          errorSummary:
            result.errorSummary ??
            (result.status === "partial"
              ? "Queued synchronization completed partially"
              : "Queued synchronization failed"),
        });
        return 1;
      }
      await processor.complete({
        id: work.id,
        leaseToken: work.leaseToken,
        status: "done",
        completedAt: processor.now(),
        syncRunId: result.runId,
      });
    } else {
      await processor.complete({
        id: work.id,
        leaseToken: work.leaseToken,
        status: "failed",
        completedAt: processor.now(),
        errorCode: "kind" in result ? "E_CONFIG_INCOMPLETE" : result.code,
        errorSummary:
          "kind" in result
            ? "Synchronization is disabled"
            : "Synchronization lock was already held",
      });
    }
    return 1;
  } catch (error) {
    await processor.complete({
      id: work.id,
      leaseToken: work.leaseToken,
      status: "failed",
      completedAt: processor.now(),
      errorCode: errorCode(error),
      errorSummary: "Queued synchronization failed before creating a run",
    });
    return 1;
  }
}

function productionAuditSink(
  db: Database,
  runId: string,
  attempt: number,
) {
  return {
    async record(entry: {
      method: string;
      normalizedPath: string;
      responseStatus?: number;
      durationMs: number;
      traceId: string;
      result: "denied" | "success" | "error";
    }): Promise<void> {
      await appendAmoApiAudit(db, {
        syncRunId: runId,
        traceId: entry.traceId,
        method: entry.method as AmoApiAuditInput["method"],
        normalizedPath: entry.normalizedPath,
        ...(entry.responseStatus !== undefined
          ? { responseStatus: entry.responseStatus }
          : {}),
        durationMs: entry.durationMs,
        attempt,
        result: entry.result,
      });
    },
  };
}

function productionTokenDependencies(
  db: Database,
  env: ServerEnv,
  context: Readonly<{ runId: string; traceId: string; fence: SyncLockFence }>,
) {
  const encryptionKey = decodeTokenEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  const oauthConfig = {
    clientId: env.AMO_CLIENT_ID,
    clientSecret: env.AMO_CLIENT_SECRET,
    redirectUri: env.AMO_REDIRECT_URI,
  };
  const transport = {
    traceId: context.traceId,
    auditSink: productionAuditSink(db, context.runId, 1),
    beforeNetwork: () => context.fence.assertOwned(),
  };
  return {
    db,
    encryptionKey,
    oauthConfig,
    transport,
    async validateRefreshedAccessToken(
      accessToken: string,
      connection: Readonly<{
        accountId: number;
        subdomain: string;
        baseUrl: string;
      }>,
    ): Promise<void> {
      await context.fence.assertOwned();
      const account: AmoAccountResponse = await amoFetch({
        method: "GET",
        url: `${connection.baseUrl}/api/v4/account`,
        schema: amoAccountResponseSchema,
        traceId: context.traceId,
        tokenProvider: { getAccessToken: async () => accessToken },
        beforeNetwork: () => context.fence.assertOwned(),
        auditSink: productionAuditSink(db, context.runId, 1),
        redirect: "error",
      });
      if (
        account.id !== connection.accountId ||
        account.subdomain !== connection.subdomain
      ) {
        throw new AppError("E_AMO_AUTH", 502);
      }
    },
    assertFence: () => context.fence.assertOwned(),
  };
}

export function createProductionAmoSyncDependencies(
  db: Database,
  env: ServerEnv,
): AmoSyncDependencies {
  return {
    envEnabled: env.SYNC_ENABLED,
    controls: {
      async isSyncEnabled() {
        return (await getSystemControl(db, "sync_enabled")).enabled;
      },
    },
    connections: {
      async getActive() {
        const connection = await getCurrentSafeAmoConnectionStatus(db);
        if (!connection || connection.status !== "active") return null;
        return {
          id: connection.id,
          accountId: connection.accountId,
          baseUrl: connection.baseUrl,
        };
      },
    },
    configs: {
      async getActive(connectionId) {
        const config = await getActivePipelineConfig(db, connectionId);
        return config ? { id: config.id, pipelineId: config.pipelineId } : null;
      },
    },
    locks: {
      withSyncLock: (connectionId, action) =>
        withSyncAdvisoryLock(db, connectionId, action),
    },
    cursors: { get: (connectionId) => getSyncCursors(db, connectionId) },
    runs: {
      async start(input) {
        const run = await startSyncRun(db, input);
        return { id: run.id, traceId: run.traceId };
      },
      finish: (runId, outcome, finishedAt) =>
        finishSyncRun(db, runId, outcome, finishedAt),
    },
    raw: {
      appendPage: (input) => appendRawPage(db, input),
      quarantinePage: (input) => quarantineRawPage(db, input),
    },
    transport: {
      requestPage: async (request) =>
        amoFetch({
          method: "GET",
          url: request.url,
          schema: z.unknown(),
          traceId: request.traceId,
          tokenProvider: request.tokenProvider,
          beforeNetwork: () => request.fence.assertOwned(),
          auditSink: {
            async record(entry) {
              await request.fence.assertOwned();
              await productionAuditSink(db, request.runId, request.attempt).record(entry);
            },
          },
          redirect: "error",
        }),
    },
    tokens: {
      createProvider(connectionId, context) {
        return createAmoTokenProvider(connectionId, {
          ...productionTokenDependencies(db, env, context),
          now: context.clock.now,
        });
      },
      refresh(connectionId, now, context) {
        return refreshConnection(
          connectionId,
          productionTokenDependencies(db, env, context),
          now,
        );
      },
    },
    audit: { append: (input) => appendAmoApiAudit(db, input) },
    reconciliation: {
      previousFullLeadCount: (connectionId) =>
        getPreviousFullLeadCount(db, connectionId),
    },
    alerts: {
      async critical(input) {
        await db`
          insert into public.sync_critical_alerts (sync_run_id, code, summary)
          values (${input.runId}, ${input.code}, ${input.summary})
          on conflict (sync_run_id, code) do nothing
        `;
      },
    },
  };
}

let defaultDependencies: AmoSyncDependencies | undefined;

export function configureAmoSync(dependencies: AmoSyncDependencies): void {
  defaultDependencies = dependencies;
}

export async function runSync(
  kind: SyncKind,
  clock: Clock = systemClock,
  options: RunSyncOptions = {},
): Promise<SyncRunResult> {
  if (defaultDependencies) {
    return createAmoSyncRunner(defaultDependencies)(kind, clock, options);
  }
  const env = parseServerEnv(process.env);
  const workerDatabaseUrl = process.env.WORKER_DATABASE_URL;
  if (!workerDatabaseUrl) {
    throw new AppError("E_CONFIG_INCOMPLETE", 500, "WORKER_DATABASE_URL is required");
  }
  const db = createServiceWorkerDbClient(workerDatabaseUrl);
  try {
    return await createAmoSyncRunner(
      createProductionAmoSyncDependencies(db, env),
    )(kind, clock, options);
  } finally {
    await closeDbClient(db);
  }
}
