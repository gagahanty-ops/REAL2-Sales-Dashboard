import {
  aggregateByChannel,
  aggregateByManager,
  aggregateDaily,
  aggregateMetrics,
  deltaPct,
  previousPeriod,
} from "@real2/domain";
import {
  GOLDEN_DAILY_RANGE,
  GOLDEN_RANGE,
  goldenChannelRows,
  goldenDailyRows,
  goldenLeadFacts,
  goldenManagerRows,
  goldenMonthTotals,
} from "@real2/testkit";
import { describe, expect, it } from "vitest";

const facts = goldenLeadFacts;

describe("canonical metrics against the golden dataset", () => {
  it("reproduces the month totals to the kopeck", () => {
    expect(aggregateMetrics({ facts, ...GOLDEN_RANGE })).toEqual(goldenMonthTotals);
  });

  it("reproduces every daily row", () => {
    expect(aggregateDaily({ facts, ...GOLDEN_DAILY_RANGE })).toEqual(goldenDailyRows);
  });

  it("reproduces every manager row", () => {
    expect(aggregateByManager({ facts, ...GOLDEN_RANGE })).toEqual(goldenManagerRows);
  });

  it("reproduces every channel row", () => {
    expect(aggregateByChannel({ facts, ...GOLDEN_RANGE })).toEqual(goldenChannelRows);
  });

  it("keeps a payment in the creation-month cohort when it happened later", () => {
    const september = aggregateMetrics({ facts, ...GOLDEN_RANGE });
    const october = aggregateMetrics({ facts, from: "2026-10-01", to: "2026-10-31" });

    expect(september.payments).toBe(3);
    expect(september.revenueRub).toBe("51001.00");
    expect(october).toMatchObject({ leadsCreated: 0, payments: 0, revenueRub: "0.00" });
  });

  it("counts a repeated observation once", () => {
    const withoutDuplicate = facts.filter(
      (fact, index) => facts.findIndex((other) => other.amoLeadId === fact.amoLeadId) === index,
    );

    expect(aggregateMetrics({ facts: withoutDuplicate, ...GOLDEN_RANGE })).toEqual(
      goldenMonthTotals,
    );
  });

  it("separates two leads created one second apart across Moscow midnight", () => {
    const eighth = aggregateMetrics({ facts, from: "2026-09-08", to: "2026-09-08" });
    const ninth = aggregateMetrics({ facts, from: "2026-09-09", to: "2026-09-09" });

    expect(eighth.leadsCreated).toBe(2);
    expect(ninth.leadsCreated).toBe(1);
  });

  it("keeps a returned win out of payments while its lead stays counted", () => {
    const day = aggregateMetrics({ facts, from: "2026-09-06", to: "2026-09-06" });

    expect(day).toMatchObject({ leadsCreated: 2, applications: 2, payments: 0 });
  });

  it("compares September with August and reports a null delta on an empty base", () => {
    const previous = previousPeriod(GOLDEN_RANGE);
    const current = aggregateMetrics({ facts, ...GOLDEN_RANGE });
    const before = aggregateMetrics({ facts, ...previous });

    expect(previous).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(before.leadsCreated).toBe(0);
    expect(deltaPct(current.leadsCreated, before.leadsCreated)).toBeNull();
  });

  it("is stable when the same facts are aggregated twice", () => {
    expect(aggregateMetrics({ facts, ...GOLDEN_RANGE })).toEqual(
      aggregateMetrics({ facts: [...facts].reverse(), ...GOLDEN_RANGE }),
    );
  });
});
