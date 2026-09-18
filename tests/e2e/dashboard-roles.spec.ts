import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./fixtures";

test.describe("role boundaries", () => {
  test("leadership sees the whole department", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE.head });
    const page = await context.newPage();

    await page.goto("/managers?from=2026-09-05&to=2026-09-06");
    await expect(page.getByRole("heading", { name: "Менеджеры" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Менеджер Один" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Менеджер Два" })).toBeVisible();

    await context.close();
  });

  test("a manager cannot reveal another manager through the UI or the API", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE["manager-one"] });
    const page = await context.newPage();

    await page.goto("/managers?from=2026-09-05&to=2026-09-06");
    await expect(page.getByRole("rowheader", { name: "Менеджер Один" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Менеджер Два" })).toHaveCount(0);

    // Asking for somebody else is refused, not silently rewritten.
    const forbidden = await context.request.get(
      "/api/dashboard/drilldown?from=2026-09-05&to=2026-09-06&manager=amo:84",
    );
    expect(forbidden.status()).toBe(403);

    const allowed = await context.request.get(
      "/api/dashboard/drilldown?from=2026-09-05&to=2026-09-06&metric=leads_created",
    );
    expect(allowed.status()).toBe(200);
    const body = (await allowed.json()) as {
      data: { rows: { manager: { id: number | null } }[] };
    };
    expect(body.data.rows.length).toBeGreaterThan(0);
    expect(body.data.rows.every((row) => row.manager.id === 42)).toBe(true);

    await context.close();
  });

  test("a manager exports only their own leads", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE["manager-two"] });

    const response = await context.request.get(
      "/api/dashboard/export.csv?from=2026-09-05&to=2026-09-06",
    );
    const csv = await response.text();

    expect(response.status()).toBe(200);
    expect(csv).toContain("Сделка #1003");
    expect(csv).not.toContain("Сделка #1001");

    await context.close();
  });

  test("an administrator reaches the settings a manager may not", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: STORAGE_STATE.admin });
    const adminPage = await admin.newPage();
    await adminPage.goto("/settings/plans");
    await expect(adminPage.getByRole("heading", { name: "Планы продаж" })).toBeVisible();
    await admin.close();

    const manager = await browser.newContext({ storageState: STORAGE_STATE["manager-one"] });
    const managerPage = await manager.newPage();
    await managerPage.goto("/settings/plans");
    await expect(managerPage).toHaveURL(/\/$/u);
    await manager.close();
  });
});
