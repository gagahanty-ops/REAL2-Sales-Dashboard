import React from "react";

import { formatDate, formatRubles } from "../../lib/dashboard/format";

export type AttentionRowView = Readonly<{
  amoLeadId: number;
  name: string;
  createdDate: string;
  manager: Readonly<{ id: number | null; name: string }>;
  channel: string;
  price: string | null;
  amoUrl: string;
  quality: readonly string[];
}>;

const CODE_LABEL: Readonly<Record<string, string>> = {
  unknown_channel: "Неизвестный канал",
  missing_responsible: "Без ответственного",
  missing_stage_history: "Нет истории этапов",
  won_without_valid_price: "Оплата без суммы",
  out_of_scope_pipeline: "Другая воронка",
  stage_history_conflict: "Противоречие в истории",
  duplicate_event: "Повтор события",
  invalid_price: "Некорректная сумма",
  malformed_event_payload: "Событие не прочитано",
};

export function qualityLabel(code: string): string {
  return CODE_LABEL[code] ?? code;
}

export function AttentionPanel({
  counters,
  rows,
}: Readonly<{
  counters: Readonly<Record<string, number>>;
  rows: readonly AttentionRowView[];
}>) {
  const codes = Object.entries(counters).sort(([left], [right]) =>
    left.localeCompare(right));

  return (
    <section aria-label="Требует внимания">
      <h2>Требует внимания</h2>
      {codes.length === 0 ? (
        <p>В этом срезе проблемных сделок нет.</p>
      ) : (
        <ul className="quality-counters">
          {codes.map(([code, count]) => (
            <li key={code}>
              {qualityLabel(code)}: {count}
            </li>
          ))}
        </ul>
      )}
      <div className="table-scroll">
        <table className="metric-table">
          <caption>Сделки с открытыми проблемами качества</caption>
          <thead>
            <tr>
              <th scope="col">Сделка</th>
              <th scope="col">Создана</th>
              <th scope="col">Менеджер</th>
              <th scope="col">Канал</th>
              <th scope="col">Сумма</th>
              <th scope="col">Проблемы</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.amoLeadId}>
                <th scope="row">
                  <a href={row.amoUrl} rel="noreferrer noopener" target="_blank">
                    {row.name}
                  </a>
                </th>
                <td>{formatDate(row.createdDate)}</td>
                <td>{row.manager.name}</td>
                <td>{row.channel}</td>
                <td>{formatRubles(row.price)}</td>
                <td>{row.quality.map(qualityLabel).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
