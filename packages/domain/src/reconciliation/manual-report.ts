import { createHash } from "node:crypto";

import { AppError } from "../errors.js";

export type ManualReportRow = Readonly<{
  date: string;
  manager: string;
  leads: number;
  applications: number;
  payments: number;
  revenueRub: string;
}>;

export type ManualReport = Readonly<{
  rows: readonly ManualReportRow[];
  /** Source evidence: the file name and the hash of its exact bytes. */
  fileName: string;
  sha256: string;
}>;

/** Exactly the headers the owner's export is documented to contain. */
export const MANUAL_REPORT_HEADERS = [
  "Дата",
  "Менеджер",
  "Лиды",
  "Заявки",
  "Оплаты",
  "Выручка",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RUSSIAN_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const INTEGER = /^\d{1,9}$/;
const MONEY = /^\d{1,12}([.,]\d{1,2})?$/;

function stripBom(value: string): string {
  return value.startsWith("﻿") ? value.slice(1) : value;
}

function splitCells(line: string): readonly string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDate(value: string): string {
  if (ISO_DATE.test(value)) return value;
  const match = RUSSIAN_DATE.exec(value);
  if (!match) throw new AppError("E_VALIDATION", 422);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseInteger(value: string): number {
  const normalized = value.replace(/\s| /gu, "");
  if (!INTEGER.test(normalized)) throw new AppError("E_VALIDATION", 422);
  return Number(normalized);
}

function parseMoney(value: string): string {
  const normalized = value.replace(/\s| |₽/gu, "");
  if (!MONEY.test(normalized)) throw new AppError("E_VALIDATION", 422);
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/**
 * Parses the manually maintained report the owner exports. It is deliberately
 * strict: an unexpected header, a formula cell, a duplicate day and manager or
 * an unreadable number is an error, because a silently repaired comparison
 * would prove nothing.
 */
export function parseManualReport(
  content: string,
  fileName: string,
): ManualReport {
  const sha256 = createHash("sha256").update(content).digest("hex");
  const lines = stripBom(content)
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "");
  const [headerLine, ...dataLines] = lines;
  if (headerLine === undefined) throw new AppError("E_VALIDATION", 422);

  const headers = splitCells(headerLine);
  if (headers.length !== MANUAL_REPORT_HEADERS.length) {
    throw new AppError("E_VALIDATION", 422);
  }
  for (let index = 0; index < MANUAL_REPORT_HEADERS.length; index += 1) {
    if (headers[index] !== MANUAL_REPORT_HEADERS[index]) {
      throw new AppError("E_VALIDATION", 422);
    }
  }

  const seen = new Set<string>();
  const rows: ManualReportRow[] = [];
  for (const line of dataLines) {
    const cells = splitCells(line);
    if (cells.length !== MANUAL_REPORT_HEADERS.length) {
      throw new AppError("E_VALIDATION", 422);
    }
    if (cells.some((cell) => /^[=+@]/u.test(cell))) {
      // A formula in an export means the file was edited, not exported.
      throw new AppError("E_VALIDATION", 422);
    }
    const [date, manager, leads, applications, payments, revenue] = cells as [
      string, string, string, string, string, string,
    ];
    if (manager.trim() === "") throw new AppError("E_VALIDATION", 422);
    const row: ManualReportRow = {
      date: parseDate(date),
      manager: manager.trim(),
      leads: parseInteger(leads),
      applications: parseInteger(applications),
      payments: parseInteger(payments),
      revenueRub: parseMoney(revenue),
    };
    const key = `${row.date}|${row.manager}`;
    if (seen.has(key)) throw new AppError("E_CONFLICT", 409);
    seen.add(key);
    rows.push(row);
  }

  if (rows.length === 0) throw new AppError("E_VALIDATION", 422);
  return { rows, fileName, sha256 };
}
