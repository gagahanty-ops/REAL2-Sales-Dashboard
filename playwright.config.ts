import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

/**
 * End-to-end gate for the dashboard. It runs the built application against the
 * local Supabase instance with both external switches off, so no amoCRM or
 * Google request can happen during a run.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "cleanup", testMatch: /cleanup\.teardown\.ts/ },
    {
      name: "dashboard",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      // The shared local database is left as the run found it.
      teardown: "cleanup",
    },
  ],
  webServer: {
    command: "pnpm --filter @real2/web exec next start --port 3100 --hostname 127.0.0.1",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: "3100" },
  },
});
