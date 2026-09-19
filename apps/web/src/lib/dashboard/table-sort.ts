export type SortDirection = "asc" | "desc";

export const SORTABLE_COLUMNS = [
  "leadsCreated",
  "applications",
  "payments",
  "revenueRub",
  "leadToApplicationPct",
  "applicationToPaymentPct",
  "averageOrderValueRub",
] as const;

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export type SortState = Readonly<{ column: SortableColumn; direction: SortDirection }>;

export function parseSort(
  column: string | undefined,
  direction: string | undefined,
): SortState {
  const known = (SORTABLE_COLUMNS as readonly string[]).includes(column ?? "")
    ? (column as SortableColumn)
    : "leadsCreated";
  return { column: known, direction: direction === "asc" ? "asc" : "desc" };
}

function valueOf(
  totals: Readonly<Record<string, unknown>>,
  column: SortableColumn,
): number | null {
  const raw = totals[column];
  if (raw === null || raw === undefined) return null;
  // Money arrives as an exact decimal string; it is compared as a number only
  // for ordering, never for arithmetic.
  return typeof raw === "string" ? Number(raw) : Number(raw);
}

/**
 * Sorts report rows by one numeric column. A `null` ratio always sinks to the
 * bottom regardless of direction: "no denominator" is not "the smallest value".
 */
export function sortRows<T extends Readonly<{ totals: Readonly<Record<string, unknown>> }>>(
  rows: readonly T[],
  sort: SortState,
): readonly T[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = valueOf(left.totals, sort.column);
    const rightValue = valueOf(right.totals, sort.column);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -factor : factor;
  });
}

export function sortHref(
  path: string,
  params: URLSearchParams,
  column: SortableColumn,
  current: SortState,
): string {
  const next = new URLSearchParams(params);
  next.set("sort", column);
  next.set("dir", current.column === column && current.direction === "desc" ? "asc" : "desc");
  return `${path}?${next.toString()}`;
}
