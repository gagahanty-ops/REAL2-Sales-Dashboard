import { AppError } from "../errors.js";
import type { MetricDateRange } from "./types.js";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseDate(value: string): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new AppError("E_VALIDATION", 422);
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertOrdered(range: MetricDateRange): Readonly<{ from: Date; to: Date }> {
  const from = parseDate(range.from);
  const to = parseDate(range.to);
  if (from.getTime() > to.getTime()) throw new AppError("E_VALIDATION", 422);
  return { from, to };
}

export function isDateInRange(date: string, range: MetricDateRange): boolean {
  assertOrdered(range);
  parseDate(date);
  return date >= range.from && date <= range.to;
}

export function dateRangeLength(range: MetricDateRange): number {
  const { from, to } = assertOrdered(range);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

export function eachDate(range: MetricDateRange): readonly string[] {
  const { from } = assertOrdered(range);
  const days = dateRangeLength(range);
  return Array.from({ length: days }, (_, index) =>
    formatDate(new Date(from.getTime() + index * DAY_MS)));
}

function isWholeCalendarMonth(from: Date, to: Date): boolean {
  const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
  return (
    from.getUTCDate() === 1
    && from.getUTCFullYear() === to.getUTCFullYear()
    && from.getUTCMonth() === to.getUTCMonth()
    && to.getUTCDate() === lastDay.getUTCDate()
  );
}

/**
 * The comparison period of METRICS_CATALOG §10: a whole calendar month is
 * compared with the previous calendar month and keeps that month's own length;
 * any other range is compared with the range immediately before it.
 */
export function previousPeriod(range: MetricDateRange): MetricDateRange {
  const { from, to } = assertOrdered(range);
  if (isWholeCalendarMonth(from, to)) {
    const previousFrom = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1),
    );
    const previousTo = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0));
    return { from: formatDate(previousFrom), to: formatDate(previousTo) };
  }
  const length = dateRangeLength(range);
  const previousTo = new Date(from.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (length - 1) * DAY_MS);
  return { from: formatDate(previousFrom), to: formatDate(previousTo) };
}
