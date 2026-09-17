import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import {
  findForbiddenPatterns,
  listTypeScriptFiles,
} from "@real2/testkit";

const amoServerRoots = [
  "packages/integrations/src/amo",
  "apps/worker/src",
  "apps/web/src/lib/amo",
  "apps/web/src/app/api/integrations/amo",
  "apps/web/src/app/api/config",
] as const;

it("allows no production amoCRM mutation method outside the OAuth exchange", async () => {
  const sourceFiles = await listTypeScriptFiles(amoServerRoots);
  const businessMutationViolations = await findForbiddenPatterns(sourceFiles, {
    patterns: [
      /method\s*:\s*["']PATCH["']/,
      /method\s*:\s*["']PUT["']/,
      /method\s*:\s*["']DELETE["']/,
    ],
    scopeMarker: /amoFetch\s*\(/,
  });
  const nonOAuthPostViolations = await findForbiddenPatterns(sourceFiles, {
    allowFiles: ["packages/integrations/src/amo/oauth.ts"],
    patterns: [/method\s*:\s*["']POST["']/],
    scopeMarker: /amoFetch\s*\(/,
  });
  const oauthSource = await readFile(
    "packages/integrations/src/amo/oauth.ts",
    "utf8",
  );
  const oauthPostCount = oauthSource.match(/method\s*:\s*["']POST["']/g)?.length ?? 0;

  expect(businessMutationViolations).toEqual([]);
  expect(nonOAuthPostViolations).toEqual([]);
  expect(oauthPostCount).toBe(1);
  expect(oauthSource).toContain(
    'const AMO_TOKEN_ENDPOINT = "https://555151.amocrm.ru/oauth2/access_token";',
  );
});
