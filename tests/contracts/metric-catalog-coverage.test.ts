import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { metricContractEvidence } from "@real2/testkit";
import { describe, expect, it } from "vitest";

const requiredCoverage = [
  "leads_created",
  "applications",
  "payments",
  "revenue",
  "lead_to_application_pct",
  "application_to_payment_pct",
  "lead_to_payment_pct",
  "average_order_value",
  "current_manager",
  "normalized_channel",
  "funnel_age",
  "plan_completion",
  "period_comparison",
  "quality_counters",
  "freshness",
  ...Array.from({ length: 10 }, (_, index) => `golden_scenario_${index + 1}`),
] as const;

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("metric catalogue coverage", () => {
  it("has executable evidence for every catalog contract", () => {
    expect(new Set(metricContractEvidence.map((item) => item.contractKey))).toEqual(
      new Set(requiredCoverage),
    );
  });

  it("names one entry per contract, with no duplicates", () => {
    expect(metricContractEvidence).toHaveLength(requiredCoverage.length);
  });

  it("points every entry at a test file that exists", async () => {
    for (const entry of metricContractEvidence) {
      await expect(access(`${repositoryRoot}${entry.file}`)).resolves.toBeUndefined();
      expect(entry.file).toMatch(/\.(test|contract\.test)\.tsx?$/);
      expect(entry.proves.length).toBeGreaterThan(20);
    }
  });
});
