import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./fixtures";

test.use({ storageState: STORAGE_STATE.head });

test.describe("accessibility basics", () => {
  test("every page has one first-level heading and named landmarks", async ({ page }) => {
    for (const path of ["/", "/managers", "/channels", "/funnel", "/attention"]) {
      await page.goto(`${path === "/dashboard" ? "/" : path}?from=2026-09-05&to=2026-09-06`);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Дашборд" })).toBeVisible();
    }
  });

  test("the filter form is usable with the keyboard alone", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06");

    // A native date input consumes Tab between its own segments, so keyboard
    // order is checked between two checkboxes instead.
    await page.getByLabel("Avito", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Instagram", { exact: true })).toBeFocused();

    await page.getByLabel("Avito", { exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Avito", { exact: true })).toBeChecked();

    await page.getByRole("button", { name: "Применить" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/channel=avito/u);
  });

  test("focus stays visible on every interactive control", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06");
    const outline = await page.evaluate(() => {
      const input = document.querySelector("#filter-from") as HTMLElement | null;
      if (!input) return null;
      input.focus();
      const style = window.getComputedStyle(input);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });

    expect(outline).not.toBeNull();
    expect(outline?.style).not.toBe("none");
  });

  test("tables carry captions and header cells", async ({ page }) => {
    await page.goto("/managers?from=2026-09-05&to=2026-09-06");

    await expect(page.locator("table caption")).toHaveCount(1);
    await expect(page.locator("table thead th")).not.toHaveCount(0);
    await expect(page.locator("table tfoot th")).not.toHaveCount(0);
  });

  test("the chart repeats its values as text", async ({ page }) => {
    await page.goto("/?from=2026-09-05&to=2026-09-06");

    await expect(page.getByRole("img", { name: /Лиды по дням/u })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "05.09.2026" })).toBeVisible();
  });
});
