import { AppError } from "../errors.js";

export const BUSINESS_TIME_ZONE = "Europe/Moscow";

/**
 * Latest accepted unix second: 9999-12-31T20:59:59Z, the last instant whose
 * Moscow business date still has a four-digit year.
 */
export const MAX_UNIX_SECONDS = 253_402_289_999;

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

const moscowDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

/**
 * Parses an ISO 8601 instant with an explicit `Z` or `±HH:MM` offset.
 * Returns null for anything ambiguous (no zone), impossible (2026-02-30,
 * `+03:07`) or outside the supported range.
 */
export function parseIsoInstant(value: string): Date | null {
  const match = ISO_INSTANT.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone, , offsetHour, offsetMinute] = match;
  if (!isCalendarDate(Number(year), Number(month), Number(day))) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== "Z" && !isRealOffset(Number(offsetHour), Number(offsetMinute))) {
    return null;
  }
  const instant = new Date(value);
  return isSupportedInstant(instant) ? instant : null;
}

/** Real-world UTC offsets use quarter hours and never exceed 14:00. */
function isRealOffset(hours: number, minutes: number): boolean {
  return minutes % 15 === 0 && minutes < 60 && hours * 60 + minutes <= 14 * 60;
}

/** Supported instants: the unix epoch through 9999-12-31T20:59:59.999Z. */
function isSupportedInstant(instant: Date): boolean {
  const milliseconds = instant.getTime();
  return (
    Number.isFinite(milliseconds)
    && milliseconds >= 0
    && milliseconds <= (MAX_UNIX_SECONDS + 1) * 1_000 - 1
  );
}

/** Returns the `Europe/Moscow` calendar day (`YYYY-MM-DD`) of an instant. */
export function toMoscowDate(instant: string | Date): string {
  const date = typeof instant === "string" ? parseIsoInstant(instant) : instant;
  if (!(date instanceof Date) || !isSupportedInstant(date)) {
    throw new AppError("E_VALIDATION", 422);
  }

  const parts = moscowDateFormat.formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  const result = `${part("year")}-${part("month")}-${part("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new AppError("E_VALIDATION", 422);
  }
  return result;
}

/**
 * Converts an amoCRM unix timestamp (seconds) to a canonical UTC instant.
 * Returns null instead of guessing when the value is missing or malformed.
 */
export function unixSecondsToInstant(value: unknown): string | null {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > MAX_UNIX_SECONDS
  ) {
    return null;
  }
  return new Date(value * 1_000).toISOString();
}
