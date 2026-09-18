/**
 * Executable evidence for every contract of `METRICS_CATALOG.md`. Each entry
 * names the file that proves it and what exactly fails when the contract
 * breaks, so coverage cannot quietly rot into a list of good intentions.
 */
export type MetricContractEvidence = Readonly<{
  contractKey: string;
  file: string;
  proves: string;
}>;

export const metricContractEvidence: readonly MetricContractEvidence[] = [
  {
    contractKey: "leads_created",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "Month, daily, manager and channel lead counts of the golden dataset.",
  },
  {
    contractKey: "applications",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "An application is counted only with a confirmed application_at.",
  },
  {
    contractKey: "payments",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "A payment needs the current won status and a confirmed won_at.",
  },
  {
    contractKey: "revenue",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "Revenue of the approved snapshot equals the golden rows to the kopeck.",
  },
  {
    contractKey: "lead_to_application_pct",
    file: "packages/domain/src/metrics/aggregate.test.ts",
    proves: "Ratio from unrounded integers, rounded to one decimal, null on zero base.",
  },
  {
    contractKey: "application_to_payment_pct",
    file: "packages/domain/src/metrics/aggregate.test.ts",
    proves: "Application-to-payment ratio and its null zero-denominator case.",
  },
  {
    contractKey: "lead_to_payment_pct",
    file: "packages/domain/src/metrics/aggregate.test.ts",
    proves: "Lead-to-payment ratio over the same cohort.",
  },
  {
    contractKey: "average_order_value",
    file: "packages/domain/src/metrics/aggregate.test.ts",
    proves: "Average order value rounds half up to the kopeck and is null without payments.",
  },
  {
    contractKey: "current_manager",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "Manager rows use the current responsible of the newest snapshot.",
  },
  {
    contractKey: "normalized_channel",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "Channel rows follow the versioned rules; an unmapped value is unknown.",
  },
  {
    contractKey: "funnel_age",
    file: "apps/worker/src/jobs/build-snapshot.integration.test.ts",
    proves: "Stage rows carry open counts, amounts and median/average age.",
  },
  {
    contractKey: "plan_completion",
    file: "apps/web/src/app/api/plans/plans.integration.test.ts",
    proves: "Plan targets are versioned and never overwritten; completion is null without a plan.",
  },
  {
    contractKey: "period_comparison",
    file: "packages/domain/src/metrics/periods.test.ts",
    proves: "Day, week, calendar month and custom range comparisons, null delta on a zero base.",
  },
  {
    contractKey: "quality_counters",
    file: "packages/domain/src/quality/gates.test.ts",
    proves: "Every catalogue counter has a policy, and only blocking codes stop publication.",
  },
  {
    contractKey: "freshness",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "The snapshot stores the source freshness of its run.",
  },
  {
    contractKey: "golden_scenario_1",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "A created lead that stays open counts once and nowhere else.",
  },
  {
    contractKey: "golden_scenario_2",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "An application on the next day stays in the creation-day cohort.",
  },
  {
    contractKey: "golden_scenario_3",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "A payment in the next month stays in the creation-month cohort.",
  },
  {
    contractKey: "golden_scenario_4",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "Re-entering the application stage adds no second application.",
  },
  {
    contractKey: "golden_scenario_5",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "A returned win leaves payments while its lead and history stay.",
  },
  {
    contractKey: "golden_scenario_6",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "A changed responsible reports under the current manager only.",
  },
  {
    contractKey: "golden_scenario_7",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "An unmapped source value becomes unknown and opens a quality issue.",
  },
  {
    contractKey: "golden_scenario_8",
    file: "tests/contracts/raw-to-snapshot.contract.test.ts",
    proves: "A win without a price counts as a payment, blocks approval, and is acceptable.",
  },
  {
    contractKey: "golden_scenario_9",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "A repeated observation changes no total.",
  },
  {
    contractKey: "golden_scenario_10",
    file: "tests/contracts/metrics.contract.test.ts",
    proves: "Two leads one second apart fall on either side of Moscow midnight.",
  },
];
