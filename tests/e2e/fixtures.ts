import { expect, type Page } from "@playwright/test";

import { E2E_IDENTITIES, type E2EIdentity } from "./seed";

export const STORAGE_STATE = {
  admin: "tests/e2e/.auth/admin.json",
  head: "tests/e2e/.auth/head.json",
  "manager-one": "tests/e2e/.auth/manager-one.json",
  "manager-two": "tests/e2e/.auth/manager-two.json",
} as const;

export function identity(key: E2EIdentity["key"]): E2EIdentity {
  const found = E2E_IDENTITIES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`unknown identity ${key}`);
  return found;
}

export async function loginAs(page: Page, key: E2EIdentity["key"]): Promise<void> {
  const user = identity(key);
  const password = process.env.E2E_PASSWORD;
  if (password === undefined) throw new Error("missing E2E_PASSWORD");

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/u, { timeout: 15_000 });
}

/** Replies to the next overview request with a retryable failure. */
export async function failNextOverview(
  page: Page,
  traceId = "01J00000000000000000000000",
): Promise<void> {
  await page.route("**/api/dashboard/overview**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "E_AMO_UPSTREAM",
          message: "Источник временно недоступен",
          trace_id: traceId,
        },
      }),
    });
  }, { times: 1 });
}
