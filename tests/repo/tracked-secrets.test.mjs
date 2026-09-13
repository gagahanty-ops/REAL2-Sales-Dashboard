import assert from "node:assert/strict";
import test from "node:test";

import { findForbiddenTrackedPaths } from "../../scripts/check-tracked-secrets.mjs";

test("tracked secret scanner rejects credential-shaped files", () => {
  assert.deepEqual(
    findForbiddenTrackedPaths([
      ".env",
      "apps/web/.env.production",
      ".env.compose.local",
      "certs/server.pem",
      "keys/private.key",
      "config/oauth-client.json",
      "config/google-service-account-prod.json",
    ]),
    [
      ".env",
      "apps/web/.env.production",
      ".env.compose.local",
      "certs/server.pem",
      "keys/private.key",
      "config/oauth-client.json",
      "config/google-service-account-prod.json",
    ],
  );
});

test("tracked secret scanner allows documented examples and ordinary JSON", () => {
  assert.deepEqual(
    findForbiddenTrackedPaths([
      ".env.example",
      "apps/web/.env.example",
      ".env.compose.example",
      "fixtures/oauth-response.example.json",
      "package.json",
      "docs/security.md",
    ]),
    [],
  );
});
