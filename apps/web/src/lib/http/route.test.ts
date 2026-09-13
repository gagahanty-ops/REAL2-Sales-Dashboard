import { describe, expect, it } from "vitest";

import { AppError } from "@real2/domain";

import { normalizeRequestPath, readJson, withRoute } from "./route";

describe("withRoute", () => {
  it("maps unknown failures without SQL or token leakage", async () => {
    const response = await withRoute(async () => {
      throw new Error("token=amo-secret select * from app_users");
    })(new Request("http://local/api/test"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "E_INTERNAL", message: "Внутренняя ошибка" },
    });
    expect(JSON.stringify(body)).not.toMatch(/amo-secret|select \*/i);
    expect(body.error.trace_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(response.headers.get("x-trace-id")).toBe(body.error.trace_id);
  });

  it("preserves only a valid incoming trace id", async () => {
    const traceId = "01J00000000000000000000000";
    const response = await withRoute(async (_request, context) => ({
      acceptedTraceId: context.traceId,
    }))(
      new Request("http://local/api/test", {
        headers: { "x-trace-id": traceId },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { acceptedTraceId: traceId },
      meta: { trace_id: traceId },
    });
  });

  it("maps safe application errors to the declared response", async () => {
    const response = await withRoute(async () => {
      throw new AppError("E_FORBIDDEN", 403, "Доступ запрещён");
    })(new Request("http://local/api/test"));

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "E_FORBIDDEN", message: "Доступ запрещён" },
    });
    expect(response.status).toBe(403);
  });
});

describe("normalizeRequestPath", () => {
  it("removes identifiers and query values from the logged path", () => {
    const request = new Request(
      "http://local/api/leads/123456/550e8400-e29b-41d4-a716-446655440000?token=secret",
    );

    expect(normalizeRequestPath(request)).toBe("/api/leads/:id/:id");
  });

  it("replaces an unknown path segment instead of logging possible PII", () => {
    const request = new Request("http://local/api/leads/ivan-ivanov");

    expect(normalizeRequestPath(request)).toBe("/api/leads/:segment");
  });
});

describe("readJson", () => {
  it("maps malformed JSON to a safe validation error", async () => {
    const request = new Request("http://local/api/test", {
      method: "POST",
      body: "{broken",
    });

    await expect(readJson(request)).rejects.toMatchObject({
      code: "E_VALIDATION",
      status: 422,
    });
  });
});
