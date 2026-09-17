import type { JSONValue } from "postgres";

import type { NormalizedLeadKey } from "./leads.js";
import type { Database } from "./client.js";

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

export type QualityRepository = Readonly<{
  open(input: OpenQualityIssueInput): Promise<QualityIssue>;
  countOpen(leadKey: Readonly<Pick<NormalizedLeadKey, "accountId" | "amoLeadId">>, code: string): Promise<number>;
}>;

function mapQualityIssue(row: QualityIssueRow): QualityIssue {
  return {
    id: row.id,
    accountId: Number(row.account_id),
    amoLeadId: row.amo_lead_id === null ? null : Number(row.amo_lead_id),
    code: row.code,
    severity: row.severity,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createQualityRepository(db: Database): QualityRepository {
  return {
    async open(input) {
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

    async countOpen(leadKey, code) {
      const [row] = await db<{ count: number }[]>`
        select count(*)::integer as count
        from public.data_quality_issues
        where account_id = ${leadKey.accountId}
          and amo_lead_id = ${leadKey.amoLeadId}
          and code = ${code}
          and status = 'open'
      `;
      if (!row) throw new Error("quality issue count returned no row");
      return row.count;
    },
  };
}
