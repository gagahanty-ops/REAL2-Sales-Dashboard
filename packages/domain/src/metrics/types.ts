import type { NormalizedChannel } from "../leads/channel.js";
import type { Rubles } from "../money/rubles.js";

/**
 * One lead as the metric engine sees it. Every field comes from the normalized
 * layer; the engine never reads raw amoCRM payloads.
 */
export type MetricLeadFact = Readonly<{
  amoLeadId: number;
  /** Moscow calendar day of `created_at`; the cohort row of every metric. */
  createdDate: string;
  applicationAt: string | null;
  wonAt: string | null;
  currentlyWon: boolean;
  priceRub: Rubles | string | null;
  channel: NormalizedChannel;
  /** Current responsible of the newest snapshot; `null` means unassigned. */
  managerId: number | null;
}>;

export type MetricDateRange = Readonly<{ from: string; to: string }>;

export type MetricFilters = Readonly<{
  managerIds?: readonly (number | null)[] | undefined;
  channels?: readonly NormalizedChannel[] | undefined;
}>;

export type AggregateInput = MetricDateRange
  & MetricFilters
  & Readonly<{ facts: readonly MetricLeadFact[] }>;

export type MetricAggregate = Readonly<{
  leadsCreated: number;
  applications: number;
  payments: number;
  /** Canonical `<integer>.<kopecks>` string; never a floating point number. */
  revenueRub: string;
  /** Percentages rounded to one decimal for display (METRICS_CATALOG §5). */
  leadToApplicationPct: number | null;
  applicationToPaymentPct: number | null;
  leadToPaymentPct: number | null;
  averageOrderValueRub: string | null;
}>;

export type DailyMetricRow = Readonly<{ date: string; metrics: MetricAggregate }>;
export type ManagerMetricRow = Readonly<{
  managerId: number | null;
  metrics: MetricAggregate;
}>;
export type ChannelMetricRow = Readonly<{
  channel: NormalizedChannel;
  metrics: MetricAggregate;
}>;
