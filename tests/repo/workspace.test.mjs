import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("pnpm discovers both apps and every shared package", () => {
  const result = spawnSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const entries = result.stdout.trim() === "" ? [] : JSON.parse(result.stdout);
  const names = entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, [
    "@real2/db",
    "@real2/domain",
    "@real2/integrations",
    "@real2/testkit",
    "@real2/web",
    "@real2/worker",
    "real2-sales-dashboard",
  ]);
});
