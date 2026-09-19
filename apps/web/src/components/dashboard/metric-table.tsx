import React from "react";

import { formatCount, formatPercent, formatRubles } from "../../lib/dashboard/format";

export type MetricTotalsView = Readonly<{
  leadsCreated: number;
  applications: number;
  payments: number;
  revenueRub: string;
  leadToApplicationPct: number | null;
  applicationToPaymentPct: number | null;
  leadToPaymentPct: number | null;
  averageOrderValueRub: string | null;
}>;

export type MetricTableRow = Readonly<{
  key: string;
  label: string;
  href?: string | undefined;
  totals: MetricTotalsView;
}>;

export type SortLink = Readonly<{ column: string; href: string; active: boolean }>;

export type MetricTableProps = Readonly<{
  caption: string;
  firstColumn: string;
  rows: readonly MetricTableRow[];
  totals: MetricTotalsView;
  /** Sorting links by column key; omitted when the table is not sortable. */
  sortLinks?: Readonly<Record<string, SortLink>> | undefined;
  /** Extra column shown after the ratios, for example a plan completion. */
  extraColumn?: Readonly<{ title: string; render: (row: MetricTableRow) => string }> | undefined;
}>;

function header(
  title: string,
  key: string,
  sortLinks: MetricTableProps["sortLinks"],
): React.ReactNode {
  const link = sortLinks?.[key];
  if (!link) return title;
  return (
    <a aria-sort={link.active ? "other" : undefined} href={link.href}>
      {title}
      {link.active ? " ↕" : ""}
    </a>
  );
}

/**
 * One table shape for managers and channels: labels stay textual, ratios show
 * an em dash when undefined, and the totals row repeats the aggregate so a
 * reader can check that the parts add up.
 */
export function MetricTable({
  caption,
  firstColumn,
  rows,
  totals,
  sortLinks,
  extraColumn,
}: MetricTableProps) {
  return (
    <div className="table-scroll">
      <table className="metric-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumn}</th>
            <th scope="col">{header("Лиды", "leadsCreated", sortLinks)}</th>
            <th scope="col">{header("Заявки", "applications", sortLinks)}</th>
            <th scope="col">{header("Оплаты", "payments", sortLinks)}</th>
            <th scope="col">{header("Выручка", "revenueRub", sortLinks)}</th>
            <th scope="col">{header("Лид → заявка", "leadToApplicationPct", sortLinks)}</th>
            <th scope="col">
              {header("Заявка → оплата", "applicationToPaymentPct", sortLinks)}
            </th>
            <th scope="col">{header("Средний чек", "averageOrderValueRub", sortLinks)}</th>
            {extraColumn ? <th scope="col">{extraColumn.title}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                {row.href ? <a href={row.href}>{row.label}</a> : row.label}
              </th>
              <td>{formatCount(row.totals.leadsCreated)}</td>
              <td>{formatCount(row.totals.applications)}</td>
              <td>{formatCount(row.totals.payments)}</td>
              <td>{formatRubles(row.totals.revenueRub)}</td>
              <td>{formatPercent(row.totals.leadToApplicationPct)}</td>
              <td>{formatPercent(row.totals.applicationToPaymentPct)}</td>
              <td>{formatRubles(row.totals.averageOrderValueRub)}</td>
              {extraColumn ? <td>{extraColumn.render(row)}</td> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Итого</th>
            <td>{formatCount(totals.leadsCreated)}</td>
            <td>{formatCount(totals.applications)}</td>
            <td>{formatCount(totals.payments)}</td>
            <td>{formatRubles(totals.revenueRub)}</td>
            <td>{formatPercent(totals.leadToApplicationPct)}</td>
            <td>{formatPercent(totals.applicationToPaymentPct)}</td>
            <td>{formatRubles(totals.averageOrderValueRub)}</td>
            {extraColumn ? <td>—</td> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
