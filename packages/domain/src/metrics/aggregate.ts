import { AppError } from "../errors.js";
import type { NormalizedChannel } from "../leads/channel.js";
import { dateRangeLength, eachDate, isDateInRange } from "./periods.js";
import type {
  AggregateInput,
  ChannelMetricRow,
  DailyMetricRow,
  ManagerMetricRow,
  MetricAggregate,
  MetricLeadFact,
} from "./types.js";

const MONEY_PATTERN = /^(0|[1-9]\d*)\.(\d{2})$/;

/** Exact money: kopecks as BigInt, never floating point (SPEC 0.6). */
function toKopecks(value: string | null): bigint {
  if (value === null) return 0n;
  const match = MONEY_PATTERN.exec(value);
  if (!match) throw new AppError("E_VALIDATION", 422);
  return BigInt(match[1] as string) * 100n + BigInt(match[2] as string);
}

function formatKopecks(kopecks: bigint): string {
  const negative = kopecks < 0n;
  const absolute = negative ? -kopecks : kopecks;
  const rubles = absolute / 100n;
  const remainder = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${rubles}.${remainder}`;
}

/** Percentage of two integers, rounded to one decimal; `null` without a base. */
export function conversion(numerator: number, denominator: number): number | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new AppError("E_VALIDATION", 422);
  }
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

export function planCompletion(actual: number, target: number): number | null {
  return conversion(actual, target);
}

/** Change against the previous period; `null` when the base is zero (§10). */
export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    throw new AppError("E_VALIDATION", 422);
  }
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

/** Average order value, rounded half up to the kopeck. */
export function moneyAverage(total: string, count: number): string | null {
  if (!Number.isSafeInteger(count) || count < 0) throw new AppError("E_VALIDATION", 422);
  if (count === 0) return null;
  const kopecks = toKopecks(total);
  const divisor = BigInt(count);
  const quotient = kopecks / divisor;
  const remainder = kopecks % divisor;
  const roundsUp = remainder * 2n >= divisor;
  return formatKopecks(roundsUp ? quotient + 1n : quotient);
}

function matchesFilters(fact: MetricLeadFact, input: AggregateInput): boolean {
  if (input.managerIds && !input.managerIds.includes(fact.managerId)) return false;
  if (input.channels && !input.channels.includes(fact.channel)) return false;
  return true;
}

/** One lead is one unit, keyed by `amo_lead_id` (METRICS_CATALOG §3). */
function selectLeads(input: AggregateInput): readonly MetricLeadFact[] {
  const selected = new Map<number, MetricLeadFact>();
  for (const fact of input.facts) {
    if (!Number.isSafeInteger(fact.amoLeadId) || fact.amoLeadId <= 0) {
      throw new AppError("E_VALIDATION", 422);
    }
    if (!isDateInRange(fact.createdDate, input) || !matchesFilters(fact, input)) continue;
    // A malformed price is a defect, not a rounding question: it is rejected
    // even when the lead is not a payment.
    toKopecks(fact.priceRub ?? null);
    if (!selected.has(fact.amoLeadId)) selected.set(fact.amoLeadId, fact);
  }
  return [...selected.values()];
}

/**
 * Canonical aggregate of METRICS_CATALOG §4–§5. Every metric belongs to the
 * lead's creation day, a payment needs both the current won status and a
 * confirmed `won_at`, and a won lead without a valid price still counts as a
 * payment while contributing nothing to revenue.
 */
export function aggregateMetrics(input: AggregateInput): MetricAggregate {
  dateRangeLength(input);
  const leads = selectLeads(input);
  const applications = leads.filter((fact) => fact.applicationAt !== null);
  const payments = leads.filter((fact) => fact.currentlyWon && fact.wonAt !== null);
  const revenue = payments.reduce(
    (sum, fact) => sum + toKopecks(fact.priceRub ?? null),
    0n,
  );
  const revenueRub = formatKopecks(revenue);

  return {
    leadsCreated: leads.length,
    applications: applications.length,
    payments: payments.length,
    revenueRub,
    leadToApplicationPct: conversion(applications.length, leads.length),
    applicationToPaymentPct: conversion(payments.length, applications.length),
    leadToPaymentPct: conversion(payments.length, leads.length),
    averageOrderValueRub: moneyAverage(revenueRub, payments.length),
  };
}

export function aggregateDaily(input: AggregateInput): readonly DailyMetricRow[] {
  return eachDate(input).map((date) => ({
    date,
    metrics: aggregateMetrics({ ...input, from: date, to: date }),
  }));
}

/** Managers in ascending ID order; the unassigned group is always last. */
export function aggregateByManager(input: AggregateInput): readonly ManagerMetricRow[] {
  const managerIds = [...new Set(selectLeads(input).map((fact) => fact.managerId))];
  const assigned = managerIds
    .filter((id): id is number => id !== null)
    .sort((left, right) => left - right);
  const groups: (number | null)[] = managerIds.includes(null)
    ? [...assigned, null]
    : assigned;
  return groups.map((managerId) => ({
    managerId,
    metrics: aggregateMetrics({ ...input, managerIds: [managerId] }),
  }));
}

export function aggregateByChannel(input: AggregateInput): readonly ChannelMetricRow[] {
  const channels = [...new Set(selectLeads(input).map((fact) => fact.channel))].sort() as
    readonly NormalizedChannel[];
  return channels.map((channel) => ({
    channel,
    metrics: aggregateMetrics({ ...input, channels: [channel] }),
  }));
}
