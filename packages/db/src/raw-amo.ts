import { AppError } from "@real2/domain";
import type { JSONValue, TransactionSql } from "postgres";

import type { Database } from "./client.js";
import type { SyncStream } from "./sync-runs.js";

export type RawEntityType = "account" | "pipeline" | "status" | "user" | "lead";

export type RawAmoObjectInput = Readonly<{
  accountId: number;
  entityType: RawEntityType;
  externalId: number;
  sourceUpdatedAt?: Date | null;
  payload: JSONValue;
  payloadSha256: string;
}>;

export type RawAmoEventInput = Readonly<{
  accountId: number;
  amoEventId: number;
  amoLeadId?: number | null;
  eventType: string;
  eventAt: Date;
  payload: JSONValue;
  payloadSha256: string;
}>;

export type AppendRawPageInput = Readonly<{
  syncRunId: string;
  stream: SyncStream;
  pageNumber: number;
  itemCount: number;
  payloadSha256: string;
  objects: readonly RawAmoObjectInput[];
  events: readonly RawAmoEventInput[];
  receivedAt?: Date;
}>;

export type QuarantineRawPageInput = Readonly<{
  syncRunId: string;
  stream: SyncStream;
  pageNumber: number;
  reasonCode: string;
  payload: JSONValue;
  payloadSha256: string;
  receivedAt?: Date;
}>;

export type AmoApiAuditInput = Readonly<{
  syncRunId?: string | null;
  traceId: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  normalizedPath: string;
  responseStatus?: number | null;
  durationMs: number;
  attempt: number;
  result: "allowed" | "denied" | "success" | "error";
  createdAt?: Date;
}>;

export type RawChannelValue = Readonly<{ value: string; count: number }>;

function conflict(): never {
  throw new AppError("E_CONFLICT", 409);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validatePageInput(input: AppendRawPageInput): void {
  if (
    !Number.isSafeInteger(input.pageNumber) ||
    input.pageNumber <= 0 ||
    !Number.isSafeInteger(input.itemCount) ||
    input.itemCount < 0 ||
    !isSha256(input.payloadSha256)
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
}

async function appendPageMetadata(
  transaction: TransactionSql,
  input: Readonly<{
    syncRunId: string;
    stream: SyncStream;
    pageNumber: number;
    itemCount: number;
    payloadSha256: string;
    receivedAt: Date;
  }>,
): Promise<void> {
  const inserted = await transaction<{ id: string }[]>`
    insert into public.sync_pages (
      sync_run_id,
      stream,
      page_number,
      item_count,
      payload_sha256,
      received_at
    ) values (
      ${input.syncRunId},
      ${input.stream},
      ${input.pageNumber},
      ${input.itemCount},
      ${input.payloadSha256},
      ${input.receivedAt}
    )
    on conflict (sync_run_id, stream, page_number) do nothing
    returning id
  `;
  if (inserted.length > 0) return;

  const [existing] = await transaction<{
    item_count: number;
    payload_sha256: string;
  }[]>`
    select item_count, payload_sha256
    from public.sync_pages
    where sync_run_id = ${input.syncRunId}
      and stream = ${input.stream}
      and page_number = ${input.pageNumber}
  `;
  if (
    !existing ||
    existing.item_count !== input.itemCount ||
    existing.payload_sha256 !== input.payloadSha256
  ) {
    conflict();
  }
}

async function appendObject(
  transaction: TransactionSql,
  syncRunId: string,
  object: RawAmoObjectInput,
  receivedAt: Date,
): Promise<void> {
  const inserted = await transaction<{ id: string }[]>`
    insert into public.raw_amo_objects (
      sync_run_id,
      account_id,
      entity_type,
      external_id,
      source_updated_at,
      payload,
      payload_sha256,
      received_at
    ) values (
      ${syncRunId},
      ${object.accountId},
      ${object.entityType},
      ${object.externalId},
      ${object.sourceUpdatedAt ?? null},
      ${transaction.json(object.payload)},
      ${object.payloadSha256},
      ${receivedAt}
    )
    on conflict (sync_run_id, entity_type, external_id) do nothing
    returning id
  `;
  if (inserted.length > 0) return;

  const [existing] = await transaction<{ payload_sha256: string }[]>`
    select payload_sha256
    from public.raw_amo_objects
    where sync_run_id = ${syncRunId}
      and entity_type = ${object.entityType}
      and external_id = ${object.externalId}
  `;
  if (!existing || existing.payload_sha256 !== object.payloadSha256) conflict();
}

async function appendEvent(
  transaction: TransactionSql,
  syncRunId: string,
  event: RawAmoEventInput,
  receivedAt: Date,
): Promise<void> {
  const inserted = await transaction<{ id: string }[]>`
    insert into public.raw_amo_events (
      sync_run_id,
      account_id,
      amo_event_id,
      amo_lead_id,
      event_type,
      event_at,
      payload,
      payload_sha256,
      received_at
    ) values (
      ${syncRunId},
      ${event.accountId},
      ${event.amoEventId},
      ${event.amoLeadId ?? null},
      ${event.eventType},
      ${event.eventAt},
      ${transaction.json(event.payload)},
      ${event.payloadSha256},
      ${receivedAt}
    )
    on conflict (account_id, amo_event_id) do nothing
    returning id
  `;
  if (inserted.length > 0) return;

  const [existing] = await transaction<{ payload_sha256: string }[]>`
    select payload_sha256
    from public.raw_amo_events
    where account_id = ${event.accountId}
      and amo_event_id = ${event.amoEventId}
  `;
  if (!existing || existing.payload_sha256 !== event.payloadSha256) conflict();
}

export async function appendRawPage(
  db: Database,
  input: AppendRawPageInput,
): Promise<void> {
  validatePageInput(input);
  const receivedAt = input.receivedAt ?? new Date();
  await db.begin(async (transaction) => {
    await appendPageMetadata(transaction, { ...input, receivedAt });
    for (const object of input.objects) {
      await appendObject(transaction, input.syncRunId, object, receivedAt);
    }
    for (const event of input.events) {
      await appendEvent(transaction, input.syncRunId, event, receivedAt);
    }
  });
}

export async function quarantineRawPage(
  db: Database,
  input: QuarantineRawPageInput,
): Promise<void> {
  const receivedAt = input.receivedAt ?? new Date();
  if (
    !Number.isSafeInteger(input.pageNumber) ||
    input.pageNumber <= 0 ||
    !isSha256(input.payloadSha256)
  ) {
    throw new AppError("E_VALIDATION", 422);
  }

  await db.begin(async (transaction) => {
    await appendPageMetadata(transaction, {
      syncRunId: input.syncRunId,
      stream: input.stream,
      pageNumber: input.pageNumber,
      itemCount: 0,
      payloadSha256: input.payloadSha256,
      receivedAt,
    });
    await transaction`
      insert into public.raw_amo_quarantine (
        sync_run_id,
        stream,
        page_number,
        reason_code,
        payload,
        payload_sha256,
        received_at
      ) values (
        ${input.syncRunId},
        ${input.stream},
        ${input.pageNumber},
        ${input.reasonCode},
        ${transaction.json(input.payload)},
        ${input.payloadSha256},
        ${receivedAt}
      )
      on conflict (sync_run_id, stream, page_number, payload_sha256) do nothing
    `;
  });
}

export async function appendAmoApiAudit(
  db: Database,
  input: AmoApiAuditInput,
): Promise<void> {
  await db`
    insert into public.amo_api_audit (
      sync_run_id,
      trace_id,
      method,
      normalized_path,
      response_status,
      duration_ms,
      attempt,
      result,
      created_at
    ) values (
      ${input.syncRunId ?? null},
      ${input.traceId},
      ${input.method},
      ${input.normalizedPath},
      ${input.responseStatus ?? null},
      ${input.durationMs},
      ${input.attempt},
      ${input.result},
      ${input.createdAt ?? new Date()}
    )
  `;
}

export async function getRawChannelValues(
  db: Database,
  input: Readonly<{ connectionId: string; sourceFieldId: number }>,
): Promise<readonly RawChannelValue[]> {
  const rows = await db<{ value: string; count: number }[]>`
    with ranked_leads as (
      select
        raw.account_id,
        raw.external_id,
        raw.payload,
        row_number() over (
          partition by raw.account_id, raw.external_id
          order by raw.source_updated_at desc nulls last,
            raw.received_at desc,
            raw.id desc
        ) as recency
      from public.raw_amo_objects as raw
      join public.sync_runs as run on run.id = raw.sync_run_id
      where run.connection_id = ${input.connectionId}
        and run.status = 'success'
        and raw.entity_type = 'lead'
    ), exact_values as (
      select distinct
        lead.account_id,
        lead.external_id,
        btrim(value_item ->> 'value') as value
      from ranked_leads as lead
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(lead.payload -> 'custom_fields_values') = 'array'
            then lead.payload -> 'custom_fields_values'
          else '[]'::jsonb
        end
      ) as field_item
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(field_item -> 'values') = 'array'
            then field_item -> 'values'
          else '[]'::jsonb
        end
      ) as value_item
      where lead.recency = 1
        and field_item ->> 'field_id' = ${String(input.sourceFieldId)}
        and jsonb_typeof(value_item -> 'value') in ('string', 'number', 'boolean')
        and btrim(value_item ->> 'value') <> ''
    )
    select value, count(*)::integer as count
    from exact_values
    group by value
    order by count desc, value asc
  `;
  return rows;
}
