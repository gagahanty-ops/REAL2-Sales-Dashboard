import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import {
  aggregateByChannel,
  aggregateByManager,
  aggregateDaily,
  aggregateMetrics,
  conversion,
  deltaPct,
  moneyAverage,
  planCompletion,
} from "./aggregate.js";
import type { MetricLeadFact } from "./types.js";

function metricLeadFact(
  overrides: Partial<MetricLeadFact> & Pick<MetricLeadFact, "amoLeadId" | "createdDate">,
): MetricLeadFact {
  return {
    applicationAt: null,
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "unknown",
    managerId: null,
    ...overrides,
  };
}

const range = { from: "2026-09-05", to: "2026-09-05" } as const;

describe("aggregateMetrics cohort rule", () => {
  it("attributes later application and payment to the lead creation day", () => {
    const facts = [
      metricLeadFact({
        amoLeadId: 101,
        createdDate: "2026-09-05",
        applicationAt: "2026-09-07T09:00:00.000Z",
        wonAt: "2026-09-10T10:00:00.000Z",
        currentlyWon: true,
        priceRub: "12500.50",
        channel: "phone_uis",
        managerId: 7,
      }),
    ];

    expect(aggregateMetrics({ facts, ...range })).toMatchObject({
      leadsCreated: 1,
      applications: 1,
      payments: 1,
      revenueRub: "12500.50",
    });
  });

  it("counts one lead once even when the fact repeats", () => {
    const fact = metricLeadFact({
      amoLeadId: 101,
      createdDate: "2026-09-05",
      currentlyWon: true,
      wonAt: "2026-09-06T09:00:00.000Z",
      priceRub: "1000.00",
    });

    expect(aggregateMetrics({ facts: [fact, fact, { ...fact }], ...range })).toMatchObject({
      leadsCreated: 1,
      payments: 1,
      revenueRub: "1000.00",
    });
  });

  it("keeps a lead out of the range when its creation day is outside it", () => {
    const facts = [
      metricLeadFact({ amoLeadId: 1, createdDate: "2026-09-04" }),
      metricLeadFact({ amoLeadId: 2, createdDate: "2026-09-05" }),
      metricLeadFact({ amoLeadId: 3, createdDate: "2026-09-06" }),
    ];

    expect(aggregateMetrics({ facts, from: "2026-09-05", to: "2026-09-05" }).leadsCreated)
      .toBe(1);
    expect(aggregateMetrics({ facts, from: "2026-09-04", to: "2026-09-06" }).leadsCreated)
      .toBe(3);
  });

  it("drops a payment whose lead returned to an open status but keeps the lead", () => {
    const facts = [
      metricLeadFact({
        amoLeadId: 101,
        createdDate: "2026-09-05",
        applicationAt: "2026-09-06T09:00:00.000Z",
        wonAt: "2026-09-07T09:00:00.000Z",
        currentlyWon: false,
        priceRub: "5000.00",
      }),
    ];

    expect(aggregateMetrics({ facts, ...range })).toMatchObject({
      leadsCreated: 1,
      applications: 1,
      payments: 0,
      revenueRub: "0.00",
    });
  });

  it("never counts a payment that no won event proves", () => {
    const facts = [
      metricLeadFact({
        amoLeadId: 101,
        createdDate: "2026-09-05",
        wonAt: null,
        currentlyWon: true,
        priceRub: "5000.00",
      }),
    ];

    expect(aggregateMetrics({ facts, ...range }).payments).toBe(0);
  });

  it("counts a won lead without a price and leaves revenue untouched", () => {
    const facts = [
      metricLeadFact({
        amoLeadId: 101,
        createdDate: "2026-09-05",
        wonAt: "2026-09-06T09:00:00.000Z",
        currentlyWon: true,
        priceRub: null,
      }),
    ];

    expect(aggregateMetrics({ facts, ...range })).toMatchObject({
      payments: 1,
      revenueRub: "0.00",
      averageOrderValueRub: "0.00",
    });
  });

  it("sums kopecks exactly", () => {
    const facts = [
      metricLeadFact({
        amoLeadId: 1,
        createdDate: "2026-09-05",
        wonAt: "2026-09-06T09:00:00.000Z",
        currentlyWon: true,
        priceRub: "0.10",
      }),
      metricLeadFact({
        amoLeadId: 2,
        createdDate: "2026-09-05",
        wonAt: "2026-09-06T09:00:00.000Z",
        currentlyWon: true,
        priceRub: "0.20",
      }),
    ];

    expect(aggregateMetrics({ facts, ...range }).revenueRub).toBe("0.30");
  });

  it("refuses an invalid range, an invalid date or an invalid price", () => {
    expect(() => aggregateMetrics({ facts: [], from: "2026-09-05", to: "2026-09-04" }))
      .toThrow(AppError);
    expect(() => aggregateMetrics({ facts: [], from: "05.09.2026", to: "2026-09-05" }))
      .toThrow(AppError);
    expect(() =>
      aggregateMetrics({
        facts: [metricLeadFact({ amoLeadId: 1, createdDate: "2026-09-05", priceRub: "12,50" })],
        ...range,
      }),
    ).toThrow(AppError);
    expect(() =>
      aggregateMetrics({
        facts: [metricLeadFact({ amoLeadId: 1, createdDate: "2026-13-05" })],
        ...range,
      }),
    ).toThrow(AppError);
  });
});

describe("aggregateMetrics filters and ratios", () => {
  const facts = [
    metricLeadFact({
      amoLeadId: 1,
      createdDate: "2026-09-05",
      applicationAt: "2026-09-06T09:00:00.000Z",
      wonAt: "2026-09-07T09:00:00.000Z",
      currentlyWon: true,
      priceRub: "1000.00",
      channel: "avito",
      managerId: 7,
    }),
    metricLeadFact({
      amoLeadId: 2,
      createdDate: "2026-09-05",
      applicationAt: "2026-09-06T09:00:00.000Z",
      channel: "site",
      managerId: 8,
    }),
    metricLeadFact({ amoLeadId: 3, createdDate: "2026-09-05", channel: "site", managerId: null }),
  ];

  it("computes conversions from unrounded integers and rounds to one decimal", () => {
    const result = aggregateMetrics({ facts, ...range });

    expect(result).toMatchObject({
      leadsCreated: 3,
      applications: 2,
      payments: 1,
      leadToApplicationPct: 66.7,
      applicationToPaymentPct: 50,
      leadToPaymentPct: 33.3,
      averageOrderValueRub: "1000.00",
    });
  });

  it("returns null ratios when the denominator is zero", () => {
    expect(conversion(0, 0)).toBeNull();
    expect(conversion(1, 0)).toBeNull();
    expect(moneyAverage("100.00", 0)).toBeNull();
    expect(planCompletion(5, 0)).toBeNull();
    expect(deltaPct(5, 0)).toBeNull();
  });

  it("filters by manager and by channel", () => {
    expect(aggregateMetrics({ facts, ...range, managerIds: [7] }).leadsCreated).toBe(1);
    expect(aggregateMetrics({ facts, ...range, channels: ["site"] }).leadsCreated).toBe(2);
    expect(
      aggregateMetrics({ facts, ...range, managerIds: [7], channels: ["site"] }).leadsCreated,
    ).toBe(0);
  });

  it("keeps an unassigned lead reachable through an explicit filter", () => {
    expect(aggregateMetrics({ facts, ...range, managerIds: [null] }).leadsCreated).toBe(1);
  });

  it("rounds money averages half up to the kopeck", () => {
    expect(moneyAverage("10.00", 3)).toBe("3.33");
    expect(moneyAverage("20.00", 3)).toBe("6.67");
    expect(moneyAverage("0.03", 2)).toBe("0.02");
  });

  it("computes plan completion and period deltas", () => {
    expect(planCompletion(12, 10)).toBe(120);
    expect(deltaPct(12, 10)).toBe(20);
    expect(deltaPct(5, 10)).toBe(-50);
  });
});

describe("metric breakdowns", () => {
  const facts = [
    metricLeadFact({
      amoLeadId: 1,
      createdDate: "2026-09-05",
      wonAt: "2026-09-06T09:00:00.000Z",
      currentlyWon: true,
      priceRub: "1000.00",
      channel: "avito",
      managerId: 7,
    }),
    metricLeadFact({ amoLeadId: 2, createdDate: "2026-09-06", channel: "site", managerId: 8 }),
    metricLeadFact({ amoLeadId: 3, createdDate: "2026-09-06", channel: "site", managerId: null }),
  ];

  it("reports every day of the range, including empty ones", () => {
    const rows = aggregateDaily({ facts, from: "2026-09-05", to: "2026-09-07" });

    expect(rows.map((row) => row.date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(rows[0]?.metrics.leadsCreated).toBe(1);
    expect(rows[1]?.metrics.leadsCreated).toBe(2);
    expect(rows[2]?.metrics.leadsCreated).toBe(0);
  });

  it("groups by manager with the unassigned group last", () => {
    const rows = aggregateByManager({ facts, from: "2026-09-05", to: "2026-09-06" });

    expect(rows.map((row) => row.managerId)).toEqual([7, 8, null]);
    expect(rows[0]?.metrics.revenueRub).toBe("1000.00");
  });

  it("groups by channel in a stable order", () => {
    const rows = aggregateByChannel({ facts, from: "2026-09-05", to: "2026-09-06" });

    expect(rows.map((row) => row.channel)).toEqual(["avito", "site"]);
    expect(rows[1]?.metrics.leadsCreated).toBe(2);
  });
});
