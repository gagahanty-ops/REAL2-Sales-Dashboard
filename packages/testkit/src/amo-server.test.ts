import { afterEach, expect, it } from "vitest";

import { createAmoMockServer, type AmoMockServer } from "./amo-server";
import { syntheticAmoFixtures } from "./amo-fixtures";

let server: AmoMockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

it("serves synthetic pages, records requests, and injects finite failures", async () => {
  server = await createAmoMockServer({
    "/api/v4/leads": [
      syntheticAmoFixtures.leadsPage(1, true),
      syntheticAmoFixtures.leadsPage(2, false),
    ],
  });
  server.failPage("/api/v4/leads", 2, 503, 1);

  const first = await fetch(`${server.origin}/api/v4/leads?page=1`);
  const failed = await fetch(`${server.origin}/api/v4/leads?page=2`);
  const recovered = await fetch(`${server.origin}/api/v4/leads?page=2`);

  expect(first.status).toBe(200);
  expect(failed.status).toBe(503);
  expect(recovered.status).toBe(200);
  expect(server.requests).toEqual([
    { method: "GET", pathname: "/api/v4/leads", page: 1 },
    { method: "GET", pathname: "/api/v4/leads", page: 2 },
    { method: "GET", pathname: "/api/v4/leads", page: 2 },
  ]);
});
