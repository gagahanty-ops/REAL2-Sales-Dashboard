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

it("keeps production amoCRM networking inside the guarded transport", async () => {
  const sourceFiles = await listTypeScriptFiles(amoServerRoots);
  const violations = await findForbiddenPatterns(sourceFiles, {
    allowFiles: ["packages/integrations/src/amo/transport.ts"],
    patterns: [
      /\bfetch\s*\(/,
      /\baxios(?:\.|\s*\()/,
      /\bgot\s*\(/,
      /(?:from|require\s*\()\s*["'](?:node:)?undici["']/,
    ],
    scopeMarker: /amo|amocrm/i,
  });

  expect(violations).toEqual([]);
});
