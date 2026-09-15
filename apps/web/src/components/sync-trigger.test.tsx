import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { expect, it } from "vitest";

import { buildManualSyncRequest, SyncTrigger } from "./sync-trigger";

it("renders the admin manual trigger and sends explicit recent confirmation", () => {
  const html = renderToStaticMarkup(<SyncTrigger recentRun />);

  expect(html).toContain("Синхронизировать");
  expect(html).toContain("Последний запуск начался менее минуты назад");
  expect(buildManualSyncRequest(true)).toMatchObject({
    method: "POST",
    body: '{"confirmRecent":true}',
  });
});

it("does not claim recent confirmation for an older run", () => {
  expect(buildManualSyncRequest(false)).toMatchObject({
    method: "POST",
    body: '{"confirmRecent":false}',
  });
});
