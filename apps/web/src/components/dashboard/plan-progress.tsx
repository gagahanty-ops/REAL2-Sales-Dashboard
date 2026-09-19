import React from "react";

import { formatPercent, formatRubles } from "../../lib/dashboard/format";

export type PlanProgressView = Readonly<{
  metricKey: string;
  targetValue: string | null;
  completionPct: number | null;
}>;

const METRIC_LABEL: Readonly<Record<string, string>> = {
  leads_created: "Лиды",
  applications: "Заявки",
  payments: "Оплаты",
  revenue: "Выручка",
};

export function PlanProgress({ plans }: Readonly<{ plans: readonly PlanProgressView[] }>) {
  if (plans.length === 0) {
    return (
      <section aria-label="План">
        <h2>План</h2>
        <p>На выбранный месяц план не задан.</p>
      </section>
    );
  }

  return (
    <section aria-label="План">
      <h2>План и факт</h2>
      <div className="table-scroll">
        <table className="metric-table">
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              <th scope="col">Цель</th>
              <th scope="col">Выполнение</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.metricKey}>
                <th scope="row">{METRIC_LABEL[plan.metricKey] ?? plan.metricKey}</th>
                <td>
                  {plan.metricKey === "revenue"
                    ? formatRubles(plan.targetValue)
                    : plan.targetValue === null
                      ? "—"
                      : String(Number(plan.targetValue))}
                </td>
                <td>{formatPercent(plan.completionPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
