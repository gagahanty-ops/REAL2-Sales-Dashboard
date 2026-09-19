import { withCurrentSnapshot, type Database } from "@real2/db";
import {
  compareManualReport,
  parseManualReport,
  type ManualReportRow,
  type ReconciliationResult,
} from "@real2/domain";

export type ReconciliationEvidence = Readonly<{
  fileName: string;
  sha256: string;
  snapshotVersion: number;
  comparedRows: number;
  differingRows: number;
  accepted: boolean;
  result: ReconciliationResult;
}>;

type SnapshotRow = {
  report_date: Date;
  manager_name: string;
  leads_created: number;
  applications: number;
  payments: number;
  revenue: string;
};

function money(value: string): string {
  return value.includes(".") ? value : `${value}.00`;
}

/**
 * Compares the owner's exported report with the same days of the current
 * approved snapshot. It reads only; nothing about the comparison changes a
 * snapshot, and a difference is never written back as a correction.
 */
export async function reconcileManualReport(
  db: Database,
  csv: string,
  fileName: string,
): Promise<ReconciliationEvidence> {
  const manual = parseManualReport(csv, fileName);
  const dates = [...new Set(manual.rows.map((row) => row.date))].sort();
  const from = dates[0] as string;
  const to = dates[dates.length - 1] as string;

  const { data, snapshot } = await withCurrentSnapshot(db, async (transaction, meta) => {
    const rows = await transaction<SnapshotRow[]>`
      select
        facts.report_date,
        facts.manager_name,
        count(*)::integer as leads_created,
        count(*) filter (where facts.application_at is not null)::integer as applications,
        count(*) filter (
          where facts.currently_won and facts.won_at is not null
        )::integer as payments,
        coalesce(
          sum(facts.price_rub) filter (
            where facts.currently_won and facts.won_at is not null
          ),
          0
        )::text as revenue
      from public.metric_lead_facts as facts
      where facts.snapshot_id = ${meta.id}
        and facts.report_date >= ${from}
        and facts.report_date <= ${to}
      group by facts.report_date, facts.manager_name
      order by facts.report_date, facts.manager_name
    `;
    return rows;
  });

  const snapshotRows: ManualReportRow[] = data.map((row) => ({
    date: row.report_date.toISOString().slice(0, 10),
    manager: row.manager_name,
    leads: row.leads_created,
    applications: row.applications,
    payments: row.payments,
    revenueRub: money(row.revenue),
  }));

  const result = compareManualReport(manual.rows, snapshotRows);
  return {
    fileName: manual.fileName,
    sha256: manual.sha256,
    snapshotVersion: snapshot.version,
    comparedRows: result.rows.length,
    differingRows: result.differingRows,
    accepted: result.accepted,
    result,
  };
}
