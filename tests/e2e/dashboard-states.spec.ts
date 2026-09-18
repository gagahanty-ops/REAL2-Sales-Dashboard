import { expect, test } from "@playwright/test";

import { STORAGE_STATE } from "./fixtures";

test.use({ storageState: STORAGE_STATE.head });

test.describe("data states", () => {
  test("shows the snapshot banner and the numbers of that snapshot", async ({ page }) => {
    await page.goto("/dashboard?from=2026-09-05&to=2026-09-06");

    await expect(page.getByRole("status").first()).toContainText("Снимок №");
    await expect(page.getByRole("region", { name: "Ключевые показатели" }))
      .toContainText("120");
  });

  test("explains an empty period instead of showing zeros without context", async ({
    page,
  }) => {
    await page.goto("/dashboard?from=2026-01-01&to=2026-01-02");

    await expect(page.getByText("За выбранный период сделок не было.")).toBeVisible();
  });

  test("reports a malformed filter without breaking the page", async ({ page }) => {
    await page.goto("/dashboard?from=2026-09-10&to=2026-09-01");

    // Next adds its own route announcer with role=alert, so the assertion
    // targets the page's own error block.
    await expect(page.locator(".data-state-error")).toContainText(
      "Проверьте параметры фильтра",
    );
    await expect(page.getByRole("link", { name: "Повторить" })).toBeVisible();
  });

  test("an API failure carries a request identifier a user can quote", async ({ page }) => {
    const response = await page.request.get(
      "/api/dashboard/overview?from=2026-09-10&to=2026-09-01",
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; trace_id?: string };
    };

    expect(response.status()).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("E_VALIDATION");
    expect(body.error?.trace_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(response.headers()["x-trace-id"]).toBe(body.error?.trace_id);
  });

  test("every dashboard page answers with its own heading", async ({ page }) => {
    for (const [path, heading] of [
      ["/dashboard", "Обзор"],
      ["/managers", "Менеджеры"],
      ["/channels", "Каналы"],
      ["/funnel", "Воронка"],
      ["/attention", "Требует внимания"],
    ] as const) {
      await page.goto(`${path}?from=2026-09-05&to=2026-09-06`);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });
});
