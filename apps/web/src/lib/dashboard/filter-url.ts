import type { DashboardFilters } from "@real2/domain";

export type ChannelOption = Readonly<{ value: string; label: string }>;

/** Channel labels of METRICS_CATALOG section 7, in reading order. */
export const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { value: "phone_uis", label: "Звонки (UIS)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "avito", label: "Avito" },
  { value: "instagram", label: "Instagram" },
  { value: "site", label: "Сайт" },
  { value: "telegram", label: "Telegram" },
  { value: "max", label: "MAX" },
  { value: "unknown", label: "Неизвестный" },
];

/**
 * Canonical URL form of the filters: the same slice always produces the same
 * link, so a shared address shows the same report.
 */
export function filtersToSearchParams(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  for (const channel of [...filters.channels].sort()) params.append("channel", channel);
  for (const managerId of [...filters.managerIds].sort((left, right) => left - right)) {
    params.append("manager", `amo:${managerId}`);
  }
  if (filters.includeUnassigned) params.append("manager", "unassigned");
  if (!filters.compare) params.set("compare", "none");
  return params;
}

export function dashboardHref(path: string, filters: DashboardFilters): string {
  const query = filtersToSearchParams(filters).toString();
  return query === "" ? path : `${path}?${query}`;
}

export function withChannelToggled(
  filters: DashboardFilters,
  channel: string,
): DashboardFilters {
  const channels = filters.channels.includes(channel as never)
    ? filters.channels.filter((value) => value !== channel)
    : [...filters.channels, channel as never];
  return { ...filters, channels: [...channels].sort() };
}

export function withManagerSelected(
  filters: DashboardFilters,
  manager: string,
): DashboardFilters {
  if (manager === "all") {
    return { ...filters, managerIds: [], includeUnassigned: false, allManagers: true };
  }
  if (manager === "unassigned") {
    return { ...filters, managerIds: [], includeUnassigned: true, allManagers: false };
  }
  return {
    ...filters,
    managerIds: [Number(manager)],
    includeUnassigned: false,
    allManagers: false,
  };
}

export function withCompare(
  filters: DashboardFilters,
  compare: boolean,
): DashboardFilters {
  return { ...filters, compare };
}

/** The value a manager select shows for the current filters. */
export function selectedManagerValue(filters: DashboardFilters): string {
  if (filters.includeUnassigned) return "unassigned";
  const [first] = filters.managerIds;
  return first === undefined ? "all" : String(first);
}
