import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./fixtures";

test.use({ storageState: STORAGE_STATE.head });

test.describe("filters live in the URL", () => {
  test("submitting the filter form writes the slice into the address", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06");

    await page.getByLabel("Сайт", { exact: true }).check();
    await page.getByRole("button", { name: "Применить" }).click();

    await expect(page).toHaveURL(/channel=site/u);
    await expect(page).toHaveURL(/from=2026-09-05/u);
  });

  test("the address survives reload and the back button", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06&channel=avito");
    await page.reload();
    await expect(page.getByLabel("Avito", { exact: true })).toBeChecked();

    await page.goto("/?from=2026-09-05&to=2026-09-06&channel=site");
    await page.goBack();
    await expect(page).toHaveURL(/channel=avito/u);
    await expect(page.getByLabel("Avito", { exact: true })).toBeChecked();
  });

  test("a shared link shows the same numbers to another leader", async ({ browser }) => {
    const link = "/managers?from=2026-09-05&to=2026-09-06&channel=site";
    const headContext = await browser.newContext({ storageState: STORAGE_STATE.head });
    const adminContext = await browser.newContext({ storageState: STORAGE_STATE.admin });
    const headPage = await headContext.newPage();
    const adminPage = await adminContext.newPage();

    await headPage.goto(link);
    await adminPage.goto(link);
    const headTotals = await headPage.locator("tfoot").innerText();
    const adminTotals = await adminPage.locator("tfoot").innerText();

    expect(headTotals).toBe(adminTotals);

    await headContext.close();
    await adminContext.close();
  });

  test("a drill-down opens the rows behind a number", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06");

    await page.getByRole("link", { name: "Открыть сделки: Оплаты" }).click();

    await expect(page).toHaveURL(/metric=payments/u);
    await expect(page.getByRole("heading", { level: 1, name: "Оплаты" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Сделка #1001" })).toBeVisible();
  });
});
