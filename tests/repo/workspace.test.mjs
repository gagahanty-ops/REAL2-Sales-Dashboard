import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

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

test("the integrations package declares its runtime schema dependency", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("packages/integrations/package.json", root), "utf8"),
  );
  const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8");

  assert.equal(manifest.dependencies.zod, "^4.0.0");
  assert.match(
    lockfile,
    /packages\/integrations:\n    dependencies:\n(?:      [^\n]+\n)*      zod:\n        specifier: \^4\.0\.0\n        version: 4\.6\.2/m,
  );
});
