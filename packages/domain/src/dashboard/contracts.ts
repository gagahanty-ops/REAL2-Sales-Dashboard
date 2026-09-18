import { z } from "zod";

import { normalizedChannelSchema } from "../amo/config.js";

/** Money always leaves the API as an exact decimal string, never a number. */
const moneySchema = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstantSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/,
);
const countSchema = z.number().int().min(0);
/** A ratio is `null` when its denominator is zero; zero never stands in. */
const ratioSchema = z.number().nullable();

export const DASHBOARD_DRILLDOWN_METRICS = [
  "leads_created",
  "applications",
  "payments",
  "revenue",
  "stage_open",
  "quality_issue",
] as const;

export const drilldownMetricSchema = z.enum(DASHBOARD_DRILLDOWN_METRICS);

export const dashboardMetaSchema = z.object({
  traceId: z.string().min(1),
  /** Every block of one response reads this single immutable version. */
  snapshotVersion: z.number().int().positive(),
  generatedAt: isoInstantSchema,
  sourceFreshAt: isoInstantSchema,
  stale: z.boolean(),
});

export const dashboardFiltersEchoSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  channels: z.array(normalizedChannelSchema),
  managerIds: z.array(z.number().int().positive()),
  includeUnassigned: z.boolean(),
  compare: z.boolean(),
});

export const metricTotalsSchema = z.object({
  leadsCreated: countSchema,
  applications: countSchema,
  payments: countSchema,
  revenueRub: moneySchema,
  leadToApplicationPct: ratioSchema,
  applicationToPaymentPct: ratioSchema,
  leadToPaymentPct: ratioSchema,
  averageOrderValueRub: moneySchema.nullable(),
});

export const metricDeltaSchema = z.object({
  leadsCreatedPct: ratioSchema,
  applicationsPct: ratioSchema,
  paymentsPct: ratioSchema,
  revenuePct: ratioSchema,
});

export const dailyPointSchema = z.object({
  date: isoDateSchema,
  leadsCreated: countSchema,
  applications: countSchema,
  payments: countSchema,
  revenueRub: moneySchema,
});

export const planProgressSchema = z.object({
  metricKey: z.enum(["leads_created", "applications", "payments", "revenue"]),
  targetValue: moneySchema.nullable(),
  completionPct: ratioSchema,
});

export const qualitySummarySchema = z.object({
  counters: z.record(z.string(), countSchema),
  approved: z.boolean(),
  blockingCodes: z.array(z.string()),
});

export const dashboardOverviewSchema = z.object({
  meta: dashboardMetaSchema,
  filters: dashboardFiltersEchoSchema,
  totals: metricTotalsSchema,
  previous: metricTotalsSchema.nullable(),
  deltas: metricDeltaSchema.nullable(),
  plans: z.array(planProgressSchema),
  daily: z.array(dailyPointSchema),
  quality: qualitySummarySchema,
});

export const managerRowSchema = z.object({
  managerKey: z.string().min(1),
  managerName: z.string().min(1),
  totals: metricTotalsSchema,
});

export const managersTableSchema = z.object({
  meta: dashboardMetaSchema,
  rows: z.array(managerRowSchema),
  totals: metricTotalsSchema,
});

export const channelRowSchema = z.object({
  channel: normalizedChannelSchema,
  totals: metricTotalsSchema,
});

export const channelsTableSchema = z.object({
  meta: dashboardMetaSchema,
  rows: z.array(channelRowSchema),
  totals: metricTotalsSchema,
});

export const funnelStageSchema = z.object({
  statusId: z.number().int().positive(),
  statusName: z.string().min(1),
  openCount: countSchema,
  openAmountRub: moneySchema,
  medianAgeSeconds: z.number().int().min(0).nullable(),
  averageAgeSeconds: z.number().int().min(0).nullable(),
});

export const funnelSchema = z.object({
  meta: dashboardMetaSchema,
  stages: z.array(funnelStageSchema),
});

/** Drill-down row of SPEC M7.3; phones never appear in `name`. */
export const drilldownRowSchema = z.object({
  amoLeadId: z.number().int().positive(),
  name: z.string().min(1),
  createdDate: isoDateSchema,
  applicationAt: isoInstantSchema.nullable(),
  wonAt: isoInstantSchema.nullable(),
  manager: z.object({
    id: z.number().int().positive().nullable(),
    name: z.string().min(1),
  }),
  channel: normalizedChannelSchema,
  price: moneySchema.nullable(),
  amoUrl: z.string().regex(/^https:\/\/[a-z0-9-]+\.amocrm\.ru\/leads\/detail\/\d+$/),
  quality: z.array(z.string()),
});

export const drilldownPageSchema = z.object({
  meta: dashboardMetaSchema,
  metric: drilldownMetricSchema,
  rows: z.array(drilldownRowSchema).max(100),
  nextCursor: z.string().min(1).nullable(),
});

export const attentionSchema = z.object({
  meta: dashboardMetaSchema,
  counters: z.record(z.string(), countSchema),
  rows: z.array(drilldownRowSchema).max(100),
});

export type DashboardMeta = z.infer<typeof dashboardMetaSchema>;
export type MetricTotals = z.infer<typeof metricTotalsSchema>;
export type MetricDelta = z.infer<typeof metricDeltaSchema>;
export type DailyPoint = z.infer<typeof dailyPointSchema>;
export type PlanProgress = z.infer<typeof planProgressSchema>;
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;
export type ManagersTable = z.infer<typeof managersTableSchema>;
export type ChannelsTable = z.infer<typeof channelsTableSchema>;
export type FunnelReport = z.infer<typeof funnelSchema>;
export type DrilldownRow = z.infer<typeof drilldownRowSchema>;
export type DrilldownPage = z.infer<typeof drilldownPageSchema>;
export type AttentionReport = z.infer<typeof attentionSchema>;
export type DrilldownMetric = z.infer<typeof drilldownMetricSchema>;
