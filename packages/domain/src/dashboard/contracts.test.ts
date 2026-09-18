import { describe, expect, it } from "vitest";

import {
  DASHBOARD_DRILLDOWN_METRICS,
  dashboardMetaSchema,
  drilldownRowSchema,
  metricTotalsSchema,
} from "./contracts.js";

const meta = {
  traceId: "01M2V6QAKXVY2D248F5NYA6FR6",
  snapshotVersion: 41,
  generatedAt: "2026-09-19T09:00:00.000Z",
  sourceFreshAt: "2026-09-19T08:55:00.000Z",
  stale: false,
};

const drilldownRow = {
  amoLeadId: 12_345_678,
  name: "Сделка #12345678",
  createdDate: "2026-09-05",
  applicationAt: "2026-09-07T09:12:00Z",
  wonAt: "2026-09-10T14:30:00Z",
  manager: { id: 42, name: "Менеджер Патя" },
  channel: "phone_uis",
  price: "12500.00",
  amoUrl: "https://555151.amocrm.ru/leads/detail/12345678",
  quality: [],
};

describe("dashboard response contracts", () => {
  it("accepts the drill-down row documented in the specification", () => {
    expect(drilldownRowSchema.parse(drilldownRow)).toMatchObject({ amoLeadId: 12_345_678 });
  });

  it("keeps money as an exact decimal string", () => {
    expect(() => drilldownRowSchema.parse({ ...drilldownRow, price: 12_500 })).toThrow();
    expect(() => drilldownRowSchema.parse({ ...drilldownRow, price: "12500.5" })).toThrow();
    expect(drilldownRowSchema.parse({ ...drilldownRow, price: null }).price).toBeNull();
  });

  it("refuses a drill-down row that points outside amoCRM", () => {
    expect(() =>
      drilldownRowSchema.parse({ ...drilldownRow, amoUrl: "https://evil.example.test/leads/1" }),
    ).toThrow();
  });

  it("allows a null ratio but never a negative count", () => {
    const totals = {
      leadsCreated: 0,
      applications: 0,
      payments: 0,
      revenueRub: "0.00",
      leadToApplicationPct: null,
      applicationToPaymentPct: null,
      leadToPaymentPct: null,
      averageOrderValueRub: null,
    };
    expect(metricTotalsSchema.parse(totals)).toMatchObject({ leadsCreated: 0 });
    expect(() => metricTotalsSchema.parse({ ...totals, payments: -1 })).toThrow();
  });

  it("requires a positive snapshot version and a freshness flag in every response", () => {
    expect(dashboardMetaSchema.parse(meta)).toMatchObject({ snapshotVersion: 41 });
    expect(() => dashboardMetaSchema.parse({ ...meta, snapshotVersion: 0 })).toThrow();
    const withoutStale: Record<string, unknown> = { ...meta };
    delete withoutStale.stale;
    expect(() => dashboardMetaSchema.parse(withoutStale)).toThrow();
  });

  it("limits drill-down metrics to the documented list", () => {
    expect(DASHBOARD_DRILLDOWN_METRICS).toEqual([
      "leads_created",
      "applications",
      "payments",
      "revenue",
      "stage_open",
      "quality_issue",
    ]);
  });
});
