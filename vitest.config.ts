import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const workspaceAliases = {
  "@real2/db": fileURLToPath(
    new URL("./packages/db/src/index.ts", import.meta.url),
  ),
  "@real2/domain": fileURLToPath(
    new URL("./packages/domain/src/index.ts", import.meta.url),
  ),
  "@real2/testkit": fileURLToPath(
    new URL("./packages/testkit/src/index.ts", import.meta.url),
  ),
};

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    // Database suites share one disposable local database. Serial files keep
    // their destructive fixtures isolated and also make CI deterministic.
    fileParallelism: false,
    projects: [
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "unit",
          include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
          exclude: [
            ...configDefaults.exclude,
            "**/*.integration.test.*",
            "**/*.contract.test.*",
            "**/*.security.test.*",
          ],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "contracts",
          include: [
            "tests/contracts/**/*.test.{ts,tsx}",
            "**/*.contract.test.{ts,tsx}",
          ],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.{ts,tsx}",
            "**/*.integration.test.{ts,tsx}",
          ],
        },
      },
      {
        resolve: { alias: workspaceAliases },
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
