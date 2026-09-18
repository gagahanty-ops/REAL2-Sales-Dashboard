const COUNT_FORMAT = new Intl.NumberFormat("ru-RU");
const MONEY_FORMAT = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/**
 * Money arrives as an exact decimal string and is converted only for display;
 * the string stays the source of truth for every calculation.
 */
export function formatRubles(value: string | null): string {
  return value === null ? "—" : MONEY_FORMAT.format(Number(value));
}

export function formatPercent(value: number | null): string {
  return value === null
    ? "—"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`;
}

/** A change against the previous period; an empty base stays an em dash. */
export function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`;
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}
