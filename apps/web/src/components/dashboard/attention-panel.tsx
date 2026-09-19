import React from "react";

import { CHANNEL_OPTIONS } from "../../lib/dashboard/filter-url";
import { formatDate, formatRubles } from "../../lib/dashboard/format";

function channelLabel(channel: string): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel;
}

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

/** SPEC M8.4: the screen is read by reason, so rows are grouped by code. */
export function groupByCode(
  rows: readonly AttentionRowView[],
): readonly Readonly<{ code: string; rows: readonly AttentionRowView[] }>[] {
  const groups = new Map<string, AttentionRowView[]>();
  for (const row of rows) {
    for (const code of row.quality) {
      groups.set(code, [...(groups.get(code) ?? []), row]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, grouped]) => ({ code, rows: grouped }));
}

export function LeadRowsTable({
  caption,
  rows,
}: Readonly<{ caption: string; rows: readonly AttentionRowView[] }>) {
  if (rows.length === 0) return <p>В этом срезе сделок нет.</p>;
  return (
    <div className="table-scroll">
      <table className="metric-table">
        <caption>{caption}</caption>
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
                <a href={`/leads/${row.amoLeadId}`}>{row.name}</a>{" "}
                <a href={row.amoUrl} rel="noreferrer noopener" target="_blank">
                  (amoCRM)
                </a>
              </th>
              <td>{formatDate(row.createdDate)}</td>
              <td>{row.manager.name}</td>
              <td>{channelLabel(row.channel)}</td>
              <td>{formatRubles(row.price)}</td>
              <td>{row.quality.map(qualityLabel).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttentionPanel({
  counters,
  rows,
  grouped = false,
}: Readonly<{
  counters: Readonly<Record<string, number>>;
  rows: readonly AttentionRowView[];
  grouped?: boolean;
}>) {
  const codes = Object.entries(counters).sort(([left], [right]) =>
    left.localeCompare(right));

  return (
    <section aria-label="Требует внимания">
      {/* The page already carries the heading; repeating it and the counters
          above identical group headings would be noise. */}
      {grouped ? null : <h2>Требует внимания</h2>}
      {codes.length === 0 ? (
        <p>В этом срезе проблемных сделок нет.</p>
      ) : grouped ? null : (
        <ul className="quality-counters">
          {codes.map(([code, count]) => (
            <li key={code}>
              {qualityLabel(code)}: {count}
            </li>
          ))}
        </ul>
      )}
      {grouped
        ? groupByCode(rows).map((group) => (
            <section aria-label={qualityLabel(group.code)} key={group.code}>
              <h3>
                {qualityLabel(group.code)}: {group.rows.length}
              </h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={`${group.code}-${row.amoLeadId}`}>
                    <a href={`/leads/${row.amoLeadId}`}>{row.name}</a> —{" "}
                    {row.manager.name}, {formatDate(row.createdDate)}
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}

      <LeadRowsTable
        caption="Сделки с открытыми проблемами качества"
        rows={rows}
      />
    </section>
  );
}
