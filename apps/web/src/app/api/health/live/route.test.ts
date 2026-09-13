import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health/live", () => {
  it("returns process liveness without dependency or secret details", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/health/live"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { live: true },
      meta: {
        trace_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        generated_at: expect.any(String),
      },
    });
  });
});
