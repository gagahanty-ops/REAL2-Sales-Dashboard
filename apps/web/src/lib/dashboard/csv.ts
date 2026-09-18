import type { DrilldownRow } from "@real2/domain";

const BOM = "﻿";
const SEPARATOR = ";";

const HEADERS = [
  "ID сделки",
  "Название",
  "Дата создания",
  "Заявка",
  "Оплата",
  "Менеджер",
  "Канал",
  "Сумма, ₽",
  "Ссылка",
  "Качество",
] as const;

/**
 * Escapes one cell. A value starting with `=`, `+`, `-` or `@` is prefixed with
 * an apostrophe so a spreadsheet treats it as text, never as a formula.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

export function toCsv(rows: readonly DrilldownRow[]): string {
  const lines = [HEADERS.map(csvCell).join(SEPARATOR)];
  for (const row of rows) {
    lines.push([
      String(row.amoLeadId),
      row.name,
      row.createdDate,
      row.applicationAt ?? "",
      row.wonAt ?? "",
      row.manager.name,
      row.channel,
      row.price ?? "",
      row.amoUrl,
      row.quality.join(" "),
    ].map(csvCell).join(SEPARATOR));
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
