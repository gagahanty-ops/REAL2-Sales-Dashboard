import type { JSONValue } from "postgres";
import { AppError, isAcceptableQualityCode } from "@real2/domain";

import type { NormalizedLeadDb } from "./leads.js";

export type QualitySeverity = "info" | "warning" | "blocking";
export type QualityStatus = "open" | "resolved" | "accepted";

export type OpenQualityIssueInput = Readonly<{
  accountId: number;
  amoLeadId: number | null;
  syncRunId?: string | null;
  code: string;
  severity: QualitySeverity;
  safeDetails?: JSONValue;
}>;

export type QualityIssue = Readonly<{
  id: string;
  accountId: number;
  amoLeadId: number | null;
  code: string;
  severity: QualitySeverity;
  status: QualityStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
}>;

export type QualityLeadKey = Readonly<{
  accountId: number;
  amoLeadId: number | null;
}>;

type QualityIssueRow = {
  id: string;
  account_id: string;
  amo_lead_id: string | null;
  code: string;
  severity: QualitySeverity;
  status: QualityStatus;
  first_seen_at: Date;
  last_seen_at: Date;
};

export type QualityIssueFilter = Readonly<{
  code?: string | undefined;
  severity?: QualitySeverity | undefined;
  status?: QualityStatus | undefined;
  /** Opaque keyset cursor from a previous page. */
  cursor?: string | null | undefined;
  pageSize?: number | undefined;
}>;

export type QualityIssuePage = Readonly<{
  items: readonly QualityIssue[];
  nextCursor: string | null;
}>;

export type AcceptQualityIssueInput = Readonly<{
  issueId: string;
  actorId: string;
  reason: string;
  acceptedAt?: Date;
}>;

export type ResolveAbsentIssuesInput = Readonly<{
  accountId: number;
  /** Leads observed by this run; other leads keep their issues untouched. */
  amoLeadIds: readonly number[];
  /** Codes this run owns; operational codes raised elsewhere are left alone. */
  codes: readonly string[];
  /** `${amoLeadId}:${code}` pairs seen again in this run. */
  observed: readonly string[];
  resolvedAt?: Date;
}>;

export type QualityRepository = Readonly<{
  open(input: OpenQualityIssueInput): Promise<QualityIssue>;
  countOpen(leadKey: QualityLeadKey, code: string): Promise<number>;
  resolveAbsent(input: ResolveAbsentIssuesInput): Promise<number>;
}>;

const MAX_QUALITY_PAGE_SIZE = 100;
const ACCEPTANCE_REASON_MIN = 10;
const ACCEPTANCE_REASON_MAX = 500;

function safePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError("E_DB", 500);
  return parsed;
}

function validateIdentity(value: number | null, required = false): void {
  if (
    (value === null && required)
    || (value !== null && (!Number.isSafeInteger(value) || value <= 0))
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
}

function mapQualityIssue(row: QualityIssueRow): QualityIssue {
  return {
    id: row.id,
    accountId: safePositiveInteger(row.account_id),
    amoLeadId: row.amo_lead_id === null ? null : safePositiveInteger(row.amo_lead_id),
    code: row.code,
    severity: row.severity,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createQualityRepository(
  db: NormalizedLeadDb,
): QualityRepository {
  return {
    async open(input) {
      validateIdentity(input.accountId, true);
      validateIdentity(input.amoLeadId);
      const [row] = await db<QualityIssueRow[]>`
        insert into public.data_quality_issues (
          account_id, amo_lead_id, sync_run_id, code, severity, safe_details
        ) values (
          ${input.accountId}, ${input.amoLeadId}, ${input.syncRunId ?? null},
          ${input.code}, ${input.severity}, ${db.json(input.safeDetails ?? {})}
        )
        on conflict (account_id, (coalesce(amo_lead_id, 0)), code)
          where status = 'open'
        do update set
          sync_run_id = excluded.sync_run_id,
          severity = excluded.severity,
          safe_details = excluded.safe_details,
          last_seen_at = excluded.last_seen_at
        returning id, account_id, amo_lead_id, code, severity, status,
          first_seen_at, last_seen_at
      `;
      if (!row) throw new Error("quality issue insert returned no row");
      return mapQualityIssue(row);
    },

    async resolveAbsent(input) {
      validateIdentity(input.accountId, true);
      if (input.amoLeadIds.length === 0 || input.codes.length === 0) return 0;
      if (input.amoLeadIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new AppError("E_VALIDATION", 422);
      }
      const observed = [...input.observed];
      const rows = await db<{ id: string }[]>`
        update public.data_quality_issues set
          status = 'resolved',
          resolved_at = ${input.resolvedAt ?? new Date()}
        where account_id = ${input.accountId}
          and status = 'open'
          and amo_lead_id is not null
          and amo_lead_id in ${db(input.amoLeadIds)}
          and code in ${db(input.codes)}
          and (amo_lead_id || ':' || code) <> all(${observed})
        returning id
      `;
      return rows.length;
    },

    async countOpen(leadKey, code) {
      validateIdentity(leadKey.accountId, true);
      validateIdentity(leadKey.amoLeadId);
      const [row] = await db<{ count: number }[]>`
        select count(*)::integer as count
        from public.data_quality_issues
        where account_id = ${leadKey.accountId}
          and amo_lead_id is not distinct from ${leadKey.amoLeadId}
          and code = ${code}
          and status = 'open'
      `;
      if (!row) throw new Error("quality issue count returned no row");
      return row.count;
    },
  };
}

function encodeCursor(issue: QualityIssue): string {
  return Buffer.from(`${issue.lastSeenAt.toISOString()}|${issue.id}`).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): Readonly<{ lastSeenAt: Date; id: string }> {
  const [seenAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const lastSeenAt = seenAt === undefined ? new Date(Number.NaN) : new Date(seenAt);
  if (id === undefined || id === "" || Number.isNaN(lastSeenAt.getTime())) {
    throw new AppError("E_VALIDATION", 422);
  }
  return { lastSeenAt, id };
}

/**
 * Keyset page of quality issues, newest observation first. Payloads and source
 * text never leave the raw layer: only safe columns are selected.
 */
export async function listQualityIssues(
  db: NormalizedLeadDb,
  filter: QualityIssueFilter = {},
): Promise<QualityIssuePage> {
  const pageSize = filter.pageSize ?? 25;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_QUALITY_PAGE_SIZE) {
    throw new AppError("E_VALIDATION", 422);
  }
  const after = filter.cursor ? decodeCursor(filter.cursor) : null;
  const rows = await db<QualityIssueRow[]>`
    select id, account_id, amo_lead_id, code, severity, status,
      first_seen_at, last_seen_at
    from public.data_quality_issues
    where (${filter.code ?? null}::text is null or code = ${filter.code ?? null})
      and (
        ${filter.severity ?? null}::public.quality_severity is null
        or severity = ${filter.severity ?? null}::public.quality_severity
      )
      and (
        ${filter.status ?? null}::public.quality_status is null
        or status = ${filter.status ?? null}::public.quality_status
      )
      and (
        ${after?.lastSeenAt ?? null}::timestamptz is null
        or (last_seen_at, id) < (${after?.lastSeenAt ?? null}, ${after?.id ?? null}::uuid)
      )
    order by last_seen_at desc, id desc
    limit ${pageSize + 1}
  `;
  const page = rows.slice(0, pageSize).map(mapQualityIssue);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > pageSize && last ? encodeCursor(last) : null,
  };
}

/**
 * Admin acceptance of a known exception (SPEC M5.3). The reason and the actor
 * are stored as evidence; amoCRM and the raw journal are never touched, and a
 * code the policy forbids can never be accepted.
 */
export async function acceptQualityIssue(
  db: NormalizedLeadDb,
  input: AcceptQualityIssueInput,
): Promise<QualityIssue> {
  const reason = input.reason.trim();
  if (
    reason.length < ACCEPTANCE_REASON_MIN
    || reason.length > ACCEPTANCE_REASON_MAX
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [existing] = await db<{ code: string }[]>`
    select code from public.data_quality_issues where id = ${input.issueId}
  `;
  if (!existing) throw new AppError("E_NOT_FOUND", 404);
  if (!isAcceptableQualityCode(existing.code)) throw new AppError("E_CONFLICT", 409);

  const acceptedAt = input.acceptedAt ?? new Date();
  const [row] = await db<QualityIssueRow[]>`
    update public.data_quality_issues set
      status = 'accepted',
      resolved_at = ${acceptedAt},
      safe_details = safe_details || ${db.json({
        acceptanceReason: reason,
        acceptedBy: input.actorId,
        acceptedAt: acceptedAt.toISOString(),
      } as JSONValue)}
    where id = ${input.issueId} and status = 'open'
    returning id, account_id, amo_lead_id, code, severity, status,
      first_seen_at, last_seen_at
  `;
  // No row means the issue was no longer open: the guarded update is what
  // makes a second acceptance a conflict, including under a race.
  if (!row) throw new AppError("E_CONFLICT", 409);
  return mapQualityIssue(row);
}

/** Counters for the publication gate, keyed as `<code>_count`. */
export async function summarizeOpenQualityIssues(
  db: NormalizedLeadDb,
): Promise<Readonly<Record<string, number>>> {
  const rows = await db<{ code: string; count: number }[]>`
    select code, count(*)::integer as count
    from public.data_quality_issues
    where status = 'open'
    group by code
  `;
  const summary: Record<string, number> = {};
  for (const row of rows) summary[`${row.code}_count`] = row.count;
  return summary;
}
