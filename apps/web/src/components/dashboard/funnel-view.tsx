import React from "react";

import { formatCount, formatRubles } from "../../lib/dashboard/format";

export type FunnelStageView = Readonly<{
  statusId: number;
  statusName: string;
  openCount: number;
  openAmountRub: string;
  medianAgeSeconds: number | null;
  averageAgeSeconds: number | null;
}>;

/** Ages are shown in days and hours; seconds would be noise for a reader. */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days} дн ${hours} ч`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

export function FunnelView({ stages }: Readonly<{ stages: readonly FunnelStageView[] }>) {
  return (
    <section aria-label="Воронка">
      <h2>Открытые сделки по этапам</h2>
      <div className="table-scroll">
        <table className="metric-table">
          <caption>
            Текущее распределение открытых сделок, суммы и время на этапе
          </caption>
          <thead>
            <tr>
              <th scope="col">Этап</th>
              <th scope="col">Сделок</th>
              <th scope="col">Сумма</th>
              <th scope="col">Медианное время</th>
              <th scope="col">Среднее время</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage.statusId}>
                <th scope="row">{stage.statusName}</th>
                <td>{formatCount(stage.openCount)}</td>
                <td>{formatRubles(stage.openAmountRub)}</td>
                <td>{formatAge(stage.medianAgeSeconds)}</td>
                <td>{formatAge(stage.averageAgeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Медиана не показывается, когда в срез попало несколько менеджеров:
        медиана медиан не является медианой.
      </p>
    </section>
  );
}
