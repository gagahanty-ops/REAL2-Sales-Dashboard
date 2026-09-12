import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
          exclude: [
            "**/*.integration.test.*",
            "**/*.contract.test.*",
            "**/*.security.test.*",
          ],
        },
      },
      {
        test: {
          name: "contracts",
          include: [
            "tests/contracts/**/*.test.{ts,tsx}",
            "**/*.contract.test.{ts,tsx}",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.{ts,tsx}",
            "**/*.integration.test.{ts,tsx}",
          ],
        },
      },
      {
        test: {
          name: "security",
          include: [
            "tests/security/**/*.test.{ts,tsx}",
            "**/*.security.test.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
