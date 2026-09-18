import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttentionPanel, qualityLabel } from "./attention-panel";
import { DailyTrend } from "./daily-trend";
import { FunnelView, formatAge } from "./funnel-view";
import { KpiGrid, kpiCards } from "./kpi-grid";
import { MetricTable, type MetricTotalsView } from "./metric-table";
import { PlanProgress } from "./plan-progress";

const EMPTY_TOTALS: MetricTotalsView = {
  leadsCreated: 0,
  applications: 0,
  payments: 0,
  revenueRub: "0.00",
  leadToApplicationPct: null,
  applicationToPaymentPct: null,
  leadToPaymentPct: null,
  averageOrderValueRub: null,
};

const TOTALS: MetricTotalsView = {
  leadsCreated: 4,
  applications: 2,
  payments: 1,
  revenueRub: "1000.00",
  leadToApplicationPct: 50,
  applicationToPaymentPct: 50,
  leadToPaymentPct: 25,
  averageOrderValueRub: "1000.00",
};

describe("KpiGrid", () => {
  it("shows a null conversion as an em dash rather than a zero", () => {
    const html = renderToStaticMarkup(
      <KpiGrid totals={EMPTY_TOTALS} deltas={null} />,
    );

    expect(html).toContain("—");
    expect(html).toContain("Лиды");
    expect(html).not.toContain("0 %");
  });

  it("links each number to its drill-down with an accessible name", () => {
    const html = renderToStaticMarkup(
      <KpiGrid
        totals={TOTALS}
        deltas={{
          leadsCreatedPct: 12.5,
          applicationsPct: null,
          paymentsPct: -50,
          revenuePct: 0,
        }}
        drilldownHref={(metric) => `/drilldown?metric=${metric}`}
      />,
    );

    expect(html).toContain('href="/drilldown?metric=payments"');
    expect(html).toContain('aria-label="Открыть сделки: Оплаты"');
    expect(html).toContain("+12,5 %");
    expect(html).toContain("-50 %");
  });

  it("builds one card per canonical metric", () => {
    const cards = kpiCards({ totals: TOTALS, deltas: null });

    expect(cards.map((card) => card.key)).toEqual([
      "leads_created",
      "applications",
      "payments",
      "revenue",
    ]);
    expect(cards.every((card) => card.href === undefined)).toBe(true);
  });
});

describe("MetricTable", () => {
  it("repeats the aggregate in a totals row so the parts can be checked", () => {
    const html = renderToStaticMarkup(
      <MetricTable
        caption="Показатели по менеджерам"
        firstColumn="Менеджер"
        rows={[
          { key: "7", label: "Менеджер один", href: "/managers/7", totals: TOTALS },
          { key: "unassigned", label: "Без ответственного", totals: EMPTY_TOTALS },
        ]}
        totals={TOTALS}
      />,
    );

    expect(html).toContain("<tfoot>");
    expect(html).toContain("Итого");
    expect(html).toContain('href="/managers/7"');
    expect(html).toContain("Без ответственного");
    // The empty row shows an em dash in both conversions and the average,
    // never a zero percent.
    expect(html.match(/—/gu)).toHaveLength(3);
  });
});

describe("DailyTrend", () => {
  it("draws a chart and repeats every value in a table", () => {
    const html = renderToStaticMarkup(
      <DailyTrend
        points={[
          { date: "2026-09-05", leadsCreated: 3, applications: 2, payments: 1, revenueRub: "1000.00" },
          { date: "2026-09-06", leadsCreated: 1, applications: 0, payments: 0, revenueRub: "0.00" },
        ]}
      />,
    );

    expect(html).toContain('role="img"');
    expect(html.match(/<rect/gu)).toHaveLength(2);
    expect(html).toContain("05.09.2026");
    expect(html).toContain("06.09.2026");
  });

  it("omits the chart but keeps the table when there is nothing to draw", () => {
    const html = renderToStaticMarkup(<DailyTrend points={[]} />);

    expect(html).not.toContain("<svg");
    expect(html).toContain("<table");
  });
});

describe("PlanProgress", () => {
  it("says plainly when no plan exists instead of showing zero completion", () => {
    expect(renderToStaticMarkup(<PlanProgress plans={[]} />)).toContain(
      "На выбранный месяц план не задан",
    );
  });

  it("shows completion and an em dash for a missing target", () => {
    const html = renderToStaticMarkup(
      <PlanProgress
        plans={[
          { metricKey: "payments", targetValue: "4.00", completionPct: 25 },
          { metricKey: "revenue", targetValue: null, completionPct: null },
        ]}
      />,
    );

    expect(html).toContain("25 %");
    expect(html).toContain("—");
    expect(html).toContain("Оплаты");
  });
});

describe("FunnelView", () => {
  it("writes ages in days and hours and explains a missing median", () => {
    const html = renderToStaticMarkup(
      <FunnelView
        stages={[
          {
            statusId: 770,
            statusName: "Первичный контакт",
            openCount: 3,
            openAmountRub: "1500.00",
            medianAgeSeconds: null,
            averageAgeSeconds: 90_000,
          },
        ]}
      />,
    );

    expect(html).toContain("Первичный контакт");
    expect(html).toContain("1 дн 1 ч");
    expect(html).toContain("медиана медиан");
  });

  it("formats an age in every unit it needs", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(0)).toBe("0 мин");
    expect(formatAge(3_600)).toBe("1 ч 0 мин");
    expect(formatAge(172_800)).toBe("2 дн 0 ч");
  });
});

describe("AttentionPanel", () => {
  it("translates quality codes and links a lead to amoCRM", () => {
    const html = renderToStaticMarkup(
      <AttentionPanel
        counters={{ unknown_channel: 2 }}
        rows={[
          {
            amoLeadId: 101,
            name: "Сделка #101",
            createdDate: "2026-09-05",
            manager: { id: 7, name: "Менеджер один" },
            channel: "site",
            price: null,
            amoUrl: "https://555151.amocrm.ru/leads/detail/101",
            quality: ["unknown_channel", "missing_responsible"],
          },
        ]}
      />,
    );

    expect(html).toContain("Неизвестный канал: 2");
    expect(html).toContain("Неизвестный канал, Без ответственного");
    expect(html).toContain('href="https://555151.amocrm.ru/leads/detail/101"');
    expect(html).toContain("—");
  });

  it("keeps an unknown code visible instead of hiding it", () => {
    expect(qualityLabel("brand_new_code")).toBe("brand_new_code");
  });

  it("says plainly when nothing needs attention", () => {
    const html = renderToStaticMarkup(<AttentionPanel counters={{}} rows={[]} />);

    expect(html).toContain("проблемных сделок нет");
  });
});
