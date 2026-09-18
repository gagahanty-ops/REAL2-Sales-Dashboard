import type {
  ChannelMetricRow,
  DailyMetricRow,
  ManagerMetricRow,
  MetricAggregate,
} from "@real2/domain";

/**
 * Expected rows for the golden dataset. A deviation of one lead or one kopeck
 * is a test failure (METRICS_CATALOG section 13).
 */

export const goldenMonthTotals: MetricAggregate = {
  leadsCreated: 11,
  applications: 7,
  payments: 3,
  revenueRub: "51000.55",
  leadToApplicationPct: 63.6,
  applicationToPaymentPct: 42.9,
  leadToPaymentPct: 27.3,
  averageOrderValueRub: "17000.18",
};

export const goldenDailyRows: readonly DailyMetricRow[] = [
  {
    date: "2026-09-05",
    metrics: {
      leadsCreated: 2,
      applications: 1,
      payments: 0,
      revenueRub: "0.00",
      leadToApplicationPct: 50,
      applicationToPaymentPct: 0,
      leadToPaymentPct: 0,
      averageOrderValueRub: null,
    },
  },
  {
    date: "2026-09-06",
    metrics: {
      leadsCreated: 2,
      applications: 2,
      payments: 0,
      revenueRub: "0.00",
      leadToApplicationPct: 100,
      applicationToPaymentPct: 0,
      leadToPaymentPct: 0,
      averageOrderValueRub: null,
    },
  },
  {
    date: "2026-09-07",
    metrics: {
      leadsCreated: 3,
      applications: 2,
      payments: 1,
      revenueRub: "0.00",
      leadToApplicationPct: 66.7,
      applicationToPaymentPct: 50,
      leadToPaymentPct: 33.3,
      averageOrderValueRub: "0.00",
    },
  },
  {
    date: "2026-09-08",
    metrics: {
      leadsCreated: 2,
      applications: 1,
      payments: 1,
      revenueRub: "1000.55",
      leadToApplicationPct: 50,
      applicationToPaymentPct: 100,
      leadToPaymentPct: 50,
      averageOrderValueRub: "1000.55",
    },
  },
  {
    date: "2026-09-09",
    metrics: {
      leadsCreated: 1,
      applications: 0,
      payments: 0,
      revenueRub: "0.00",
      leadToApplicationPct: 0,
      applicationToPaymentPct: null,
      leadToPaymentPct: 0,
      averageOrderValueRub: null,
    },
  },
];

export const goldenManagerRows: readonly ManagerMetricRow[] = [
  {
    managerId: 7,
    metrics: {
      leadsCreated: 5,
      applications: 3,
      payments: 1,
      revenueRub: "1000.55",
      leadToApplicationPct: 60,
      applicationToPaymentPct: 33.3,
      leadToPaymentPct: 20,
      averageOrderValueRub: "1000.55",
    },
  },
  {
    managerId: 8,
    metrics: {
      leadsCreated: 4,
      applications: 2,
      payments: 1,
      revenueRub: "50000.00",
      leadToApplicationPct: 50,
      applicationToPaymentPct: 50,
      leadToPaymentPct: 25,
      averageOrderValueRub: "50000.00",
    },
  },
  {
    managerId: 9,
    metrics: {
      leadsCreated: 2,
      applications: 2,
      payments: 1,
      revenueRub: "0.00",
      leadToApplicationPct: 100,
      applicationToPaymentPct: 50,
      leadToPaymentPct: 50,
      averageOrderValueRub: "0.00",
    },
  },
];

const openOnlyChannel = (leads: number, applications: number): MetricAggregate => ({
  leadsCreated: leads,
  applications,
  payments: 0,
  revenueRub: "0.00",
  leadToApplicationPct: applications === 0 ? 0 : 100,
  applicationToPaymentPct: applications === 0 ? null : 0,
  leadToPaymentPct: 0,
  averageOrderValueRub: null,
});

export const goldenChannelRows: readonly ChannelMetricRow[] = [
  { channel: "avito", metrics: openOnlyChannel(1, 1) },
  { channel: "instagram", metrics: openOnlyChannel(1, 1) },
  {
    channel: "max",
    metrics: {
      leadsCreated: 1,
      applications: 1,
      payments: 1,
      revenueRub: "0.00",
      leadToApplicationPct: 100,
      applicationToPaymentPct: 100,
      leadToPaymentPct: 100,
      averageOrderValueRub: "0.00",
    },
  },
  {
    channel: "phone_uis",
    metrics: {
      leadsCreated: 1,
      applications: 1,
      payments: 1,
      revenueRub: "50000.00",
      leadToApplicationPct: 100,
      applicationToPaymentPct: 100,
      leadToPaymentPct: 100,
      averageOrderValueRub: "50000.00",
    },
  },
  {
    channel: "site",
    metrics: {
      leadsCreated: 4,
      applications: 1,
      payments: 1,
      revenueRub: "1000.55",
      leadToApplicationPct: 25,
      applicationToPaymentPct: 100,
      leadToPaymentPct: 25,
      averageOrderValueRub: "1000.55",
    },
  },
  { channel: "telegram", metrics: openOnlyChannel(1, 1) },
  { channel: "unknown", metrics: openOnlyChannel(1, 0) },
  { channel: "whatsapp", metrics: openOnlyChannel(1, 1) },
];
