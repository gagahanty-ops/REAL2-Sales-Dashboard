import React from "react";

import { formatCount, formatDelta, formatRubles } from "../../lib/dashboard/format";

export type KpiCard = Readonly<{
  key: string;
  label: string;
  value: string;
  delta: number | null;
  /** Drill-down link; omitted when the viewer may not open the rows. */
  href?: string;
}>;

export type KpiGridProps = Readonly<{
  totals: Readonly<{
    leadsCreated: number;
    applications: number;
    payments: number;
    revenueRub: string;
  }>;
  deltas: Readonly<{
    leadsCreatedPct: number | null;
    applicationsPct: number | null;
    paymentsPct: number | null;
    revenuePct: number | null;
  }> | null;
  drilldownHref?: (metric: string) => string;
}>;

export function kpiCards({ totals, deltas, drilldownHref }: KpiGridProps): readonly KpiCard[] {
  return [
    {
      key: "leads_created",
      label: "Лиды",
      value: formatCount(totals.leadsCreated),
      delta: deltas?.leadsCreatedPct ?? null,
    },
    {
      key: "applications",
      label: "Заявки",
      value: formatCount(totals.applications),
      delta: deltas?.applicationsPct ?? null,
    },
    {
      key: "payments",
      label: "Оплаты",
      value: formatCount(totals.payments),
      delta: deltas?.paymentsPct ?? null,
    },
    {
      key: "revenue",
      label: "Выручка",
      value: formatRubles(totals.revenueRub),
      delta: deltas?.revenuePct ?? null,
    },
  ].map((card) => (drilldownHref ? { ...card, href: drilldownHref(card.key) } : card));
}

export function KpiGrid(props: KpiGridProps) {
  return (
    <section className="kpi-grid" aria-label="Ключевые показатели">
      {kpiCards(props).map((card) => (
        <article className="kpi-card" key={card.key}>
          <h2 id={`kpi-${card.key}`}>{card.label}</h2>
          <p className="kpi-value">
            {card.href ? (
              <a href={card.href} aria-label={`Открыть сделки: ${card.label}`}>
                {card.value}
              </a>
            ) : (
              card.value
            )}
          </p>
          <p className="kpi-delta">{formatDelta(card.delta)}</p>
        </article>
      ))}
    </section>
  );
}
