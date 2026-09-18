import { test as setup } from "@playwright/test";

import { STORAGE_STATE, loginAs } from "./fixtures";
import { seedDashboardE2E } from "./seed";

/**
 * Seeds the fixtures once and stores one signed-in state per role. Each role
 * gets its own browser context and is never signed out: signing out would
 * revoke the very token the saved state depends on.
 */
setup("seed fixtures and sign every role in", async ({ browser }) => {
  setup.setTimeout(180_000);
  await seedDashboardE2E();

  for (const key of ["admin", "head", "manager-one", "manager-two"] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, key);
    await context.storageState({ path: STORAGE_STATE[key] });
    await context.close();
  }
});
