import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";

import { AmoIntegrationManager } from "./amo-integration-manager";

const baseStatus = {
  accountId: 4_242,
  subdomain: "555151",
  expiresAt: "2026-09-14T12:00:00.000Z",
  lastCheckedAt: "2026-09-14T12:00:00.000Z",
} as const;

describe("AmoIntegrationManager", () => {
  it.each(["disabled", "reauth_required"] as const)(
    "disables refresh and disconnect for %s connections",
    (status) => {
      const html = renderToStaticMarkup(
        <AmoIntegrationManager initialStatus={{ ...baseStatus, status }} />,
      );

      expect(html.match(/disabled=""/g)).toHaveLength(2);
      expect(html).toContain("Проверить чтение");
      expect(html).toContain("Отключить");
    },
  );
});
