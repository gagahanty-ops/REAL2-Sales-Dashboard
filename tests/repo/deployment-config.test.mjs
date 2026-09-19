import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const PROTECTED_SPREADSHEET_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";

test("production compose never enables network switches by default", async () => {
  const compose = await readFile("deploy/docker-compose.production.yml", "utf8");

  assert.doesNotMatch(compose, /SYNC_ENABLED:\s*["']?true/i);
  assert.doesNotMatch(compose, /SHEET_PUBLISH_ENABLED:\s*["']?true/i);
  assert.doesNotMatch(compose, new RegExp(PROTECTED_SPREADSHEET_ID));
});

test("production compose hardens both application containers", async () => {
  const compose = await readFile("deploy/docker-compose.production.yml", "utf8");

  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /env_file:/);
  assert.doesNotMatch(compose, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});

test("the reverse proxy overwrites the headers the application trusts", async () => {
  const caddyfile = await readFile("deploy/Caddyfile", "utf8");

  assert.match(caddyfile, /request_header -X-Real2-Proxy-Secret/);
  assert.match(caddyfile, /request_header -X-Real-IP/);
  assert.match(caddyfile, /Strict-Transport-Security/);
  assert.doesNotMatch(caddyfile, /X-Forwarded-For/);
});

test("the configuration checker rejects an unsafe compose file", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const run = promisify(execFile);

  const directory = await mkdtemp(join(tmpdir(), "real2-deploy-"));
  const unsafe = join(directory, "compose.yml");
  await writeFile(
    unsafe,
    "services:\n  worker:\n    environment:\n      SHEET_PUBLISH_ENABLED: 'true'\n",
    "utf8",
  );

  try {
    await assert.rejects(run("node", ["scripts/check-deployment-config.mjs", unsafe]));
    const safe = await run("node", [
      "scripts/check-deployment-config.mjs",
      "deploy/docker-compose.production.yml",
    ]);
    assert.match(safe.stdout, /safe/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
