export function formatMoscowDateTime(value: Date | null): string {
  if (!value) return "выполняется";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

export type SyncHistoryPagination = Readonly<{
  currentPage: number;
  totalPages: number;
  previousHref: string | null;
  nextHref: string | null;
}>;

export function syncHistoryPagination(input: Readonly<{
  page: number;
  pageSize: number;
  total: number;
}>): SyncHistoryPagination {
  const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
  const currentPage = Math.min(Math.max(1, input.page), totalPages);
  return {
    currentPage,
    totalPages,
    previousHref: currentPage > 1 ? `/sync?page=${currentPage - 1}` : null,
    nextHref: currentPage < totalPages ? `/sync?page=${currentPage + 1}` : null,
  };
}
