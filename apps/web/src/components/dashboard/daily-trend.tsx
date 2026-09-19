import React from "react";

import { formatCount, formatDate, formatRubles } from "../../lib/dashboard/format";

export type DailyPointView = Readonly<{
  date: string;
  leadsCreated: number;
  applications: number;
  payments: number;
  revenueRub: string;
}>;

export type DailyTrendProps = Readonly<{ points: readonly DailyPointView[] }>;

const CHART_HEIGHT = 120;
const CHART_WIDTH = 720;

/**
 * A bar chart drawn as inline SVG, with the same numbers available as a table
 * underneath: the picture is a convenience, the table is the evidence.
 */
export function DailyTrend({ points }: DailyTrendProps) {
  const maximum = Math.max(1, ...points.map((point) => point.leadsCreated));
  const barWidth = points.length === 0 ? 0 : CHART_WIDTH / points.length;

  return (
    <section aria-label="Динамика по дням">
      <h2>По дням</h2>
      {points.length > 0 ? (
        <svg
          className="daily-trend"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="xMidYMax meet"
          role="img"
          aria-label={`Лиды по дням, максимум ${maximum}`}
        >
          {points.map((point, index) => {
            const height = (point.leadsCreated / maximum) * CHART_HEIGHT;
            return (
              <rect
                key={point.date}
                x={index * barWidth + barWidth * 0.15}
                y={CHART_HEIGHT - height}
                width={Math.min(barWidth * 0.7, 48)}
                height={height}
                fill="currentColor"
              />
            );
          })}
        </svg>
      ) : null}
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Лиды, заявки, оплаты и выручка по дням
          </caption>
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Лиды</th>
              <th scope="col">Заявки</th>
              <th scope="col">Оплаты</th>
              <th scope="col">Выручка</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatDate(point.date)}</th>
                <td>{formatCount(point.leadsCreated)}</td>
                <td>{formatCount(point.applications)}</td>
                <td>{formatCount(point.payments)}</td>
                <td>{formatRubles(point.revenueRub)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
