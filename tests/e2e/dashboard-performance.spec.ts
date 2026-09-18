import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./fixtures";

test.use({ storageState: STORAGE_STATE.head });

/**
 * Budgets of the seeded profile. They are deliberately generous: the point is
 * to catch a query that degrades by an order of magnitude, not to benchmark
 * the machine.
 */
const OVERVIEW_BUDGET_MS = 2_000;
const FILTERED_BUDGET_MS = 700;
const DRILLDOWN_BUDGET_MS = 1_500;

async function measure(action: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await action();
  return Date.now() - started;
}

test.describe("response budgets", () => {
  test("the overview API answers within its budget", async ({ page }) => {
    // One warm-up request so the measurement is not a cold-start figure.
    await page.request.get("/api/dashboard/overview?from=2026-09-05&to=2026-09-06");

    const duration = await measure(async () => {
      const response = await page.request.get(
        "/api/dashboard/overview?from=2026-09-05&to=2026-09-06",
      );
      expect(response.status()).toBe(200);
    });

    expect(duration).toBeLessThan(OVERVIEW_BUDGET_MS);
  });

  test("a filtered query stays fast", async ({ page }) => {
    await page.request.get(
      "/api/dashboard/managers?from=2026-09-05&to=2026-09-06&channel=site",
    );

    const duration = await measure(async () => {
      const response = await page.request.get(
        "/api/dashboard/managers?from=2026-09-05&to=2026-09-06&channel=site",
      );
      expect(response.status()).toBe(200);
    });

    expect(duration).toBeLessThan(FILTERED_BUDGET_MS);
  });

  test("the drill-down page renders within its budget", async ({ page }) => {
    await page.goto("/drilldown?from=2026-09-05&to=2026-09-06&metric=leads_created");

    const duration = await measure(async () => {
      await page.goto("/drilldown?from=2026-09-05&to=2026-09-06&metric=leads_created");
      await expect(page.getByRole("heading", { level: 1, name: "Лиды" })).toBeVisible();
    });

    expect(duration).toBeLessThan(DRILLDOWN_BUDGET_MS);
  });
});
