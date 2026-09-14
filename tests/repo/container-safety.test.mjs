import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Compose keeps both external network switches literally disabled", async () => {
  const compose = await read("docker-compose.yml");

  assert.match(compose, /SYNC_ENABLED:\s*["']false["']/);
  assert.match(compose, /SHEET_PUBLISH_ENABLED:\s*["']false["']/);
  assert.match(compose, /AMO_CLIENT_ID:\s*["']synthetic-client-id["']/);
  assert.match(compose, /AMO_CLIENT_SECRET:\s*["']synthetic-client-secret-change-before-use["']/);
  assert.match(
    compose,
    /AMO_REDIRECT_URI:\s*["']https:\/\/dashboard\.example\.invalid\/api\/integrations\/amo\/callback["']/,
  );
  assert.match(compose, /TOKEN_ENCRYPTION_KEY:\s*["']bG9jYWwtc3ludGhldGljLWVuY3J5cHRpb24ta2V5ISE=["']/);
  assert.doesNotMatch(compose, /(?:SYNC_ENABLED|SHEET_PUBLISH_ENABLED):[^\n]*\$\{/);
  assert.doesNotMatch(compose, /123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks/);
  assert.match(compose, /127\.0\.0\.1:\$\{WEB_PORT:-3000\}:3000/);
  assert.match(compose, /restart:\s*["']no["']/);
  assert.doesNotMatch(compose, /DATABASE_URL:[^\n]*\$\{/);
  assert.match(
    compose,
    /DATABASE_URL:\s*["']postgresql:\/\/postgres:postgres@host\.docker\.internal:54322\/postgres["']/,
  );
});

test("container builds do not accept credentials as build arguments", async () => {
  for (const path of ["Dockerfile.web", "Dockerfile.worker"]) {
    const dockerfile = await read(path);

    assert.doesNotMatch(
      dockerfile,
      /^ARG\s+.*(?:TOKEN|KEY|PASSWORD|SECRET|CREDENTIAL)/im,
    );
    assert.match(dockerfile, /^USER node$/m);
  }
});

test("CI uses pull request code without privileged target execution", async () => {
  const workflow = await read(".github/workflows/ci.yml");

  assert.match(workflow, /^permissions:\n\s+contents: read$/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /docker compose build web/);
  assert.match(workflow, /docker compose --profile worker build worker/);
  assert.match(
    workflow,
    /supabase db lint --db-url "\$TEST_DATABASE_URL" --fail-on error/,
  );
});

test("Docker build context excludes local credentials", async () => {
  const dockerignore = await read(".dockerignore");
  const patterns = new Set(dockerignore.split(/\r?\n/));

  for (const pattern of [
    ".env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*oauth*.json",
    "**/*service-account*.json",
  ]) {
    assert.ok(patterns.has(pattern), `missing Docker ignore pattern: ${pattern}`);
  }
});
