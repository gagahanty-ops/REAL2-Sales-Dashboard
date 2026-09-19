import type { ManualReportRow } from "./manual-report.js";

export type ReconciliationDifference = Readonly<{
  leads: number;
  applications: number;
  payments: number;
  revenueRub: string;
}>;

export type ReconciliationRow = Readonly<{
  date: string;
  manager: string;
  manual: ManualReportRow | null;
  snapshot: ManualReportRow | null;
  difference: ReconciliationDifference;
  /** A row present on one side only is never silently dropped. */
  missingIn: "manual" | "snapshot" | null;
}>;

export type ReconciliationResult = Readonly<{
  rows: readonly ReconciliationRow[];
  accepted: boolean;
  differingRows: number;
}>;

function kopecks(value: string): bigint {
  const [whole, fraction = "00"] = value.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function formatKopecks(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

export function isZeroDifference(value: ReconciliationDifference): boolean {
  return (
    value.leads === 0
    && value.applications === 0
    && value.payments === 0
    && kopecks(value.revenueRub) === 0n
  );
}

const EMPTY: ManualReportRow = {
  date: "",
  manager: "",
  leads: 0,
  applications: 0,
  payments: 0,
  revenueRub: "0.00",
};

/**
 * Compares the manually maintained report with the same rows of an approved
 * snapshot. Differences are exact — to one lead and one kopeck — and a row
 * that exists on only one side is reported as such rather than treated as a
 * zero.
 */
export function compareManualReport(
  manual: readonly ManualReportRow[],
  snapshot: readonly ManualReportRow[],
): ReconciliationResult {
  const keys = new Set<string>();
  const manualByKey = new Map<string, ManualReportRow>();
  const snapshotByKey = new Map<string, ManualReportRow>();

  for (const row of manual) {
    const key = `${row.date}|${row.manager}`;
    manualByKey.set(key, row);
    keys.add(key);
  }
  for (const row of snapshot) {
    const key = `${row.date}|${row.manager}`;
    snapshotByKey.set(key, row);
    keys.add(key);
  }

  const rows = [...keys]
    .sort()
    .map((key) => {
      const [date = "", manager = ""] = key.split("|");
      const manualRow = manualByKey.get(key) ?? null;
      const snapshotRow = snapshotByKey.get(key) ?? null;
      const left = manualRow ?? EMPTY;
      const right = snapshotRow ?? EMPTY;
      return {
        date,
        manager,
        manual: manualRow,
        snapshot: snapshotRow,
        difference: {
          leads: left.leads - right.leads,
          applications: left.applications - right.applications,
          payments: left.payments - right.payments,
          revenueRub: formatKopecks(kopecks(left.revenueRub) - kopecks(right.revenueRub)),
        },
        missingIn: manualRow === null
          ? ("manual" as const)
          : snapshotRow === null
            ? ("snapshot" as const)
            : null,
      };
    });

  const differingRows = rows.filter(
    (row) => row.missingIn !== null || !isZeroDifference(row.difference),
  ).length;

  return { rows, accepted: differingRows === 0, differingRows };
}
