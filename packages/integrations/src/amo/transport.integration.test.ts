import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { amoFetch } from "./transport";

const accountSchema = z.object({ id: z.number() });
const allowedUrl = "https://555151.amocrm.ru/api/v4/account?page=2";

function createRequest(overrides: Record<string, unknown> = {}) {
  const ledger: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const audit: unknown[] = [];
  const tokenProvider = { getAccessToken: vi.fn(async () => "synthetic-token") };
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    ledger.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  });

  return {
    ledger,
    audit,
    tokenProvider,
    fetchFn,
    request: {
      method: "GET",
      url: allowedUrl,
      schema: accountSchema,
      traceId: "trace-123",
      tokenProvider,
      fetchFn,
      auditSink: {
        record: (entry: unknown) => {
          audit.push(entry);
        },
      },
      ...overrides,
    },
  };
}

describe("amoFetch", () => {
  it("preserves allowed GET query parameters while auditing only the normalized path", async () => {
    const { audit, fetchFn, ledger, request, tokenProvider } = createRequest();

    await expect(amoFetch(request)).resolves.toEqual({ id: 1 });

    expect(tokenProvider.getAccessToken).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(ledger).toEqual([
      {
        url: allowedUrl,
        init: expect.objectContaining({
          method: "GET",
          redirect: "error",
          headers: expect.any(Headers),
        }),
      },
    ]);
    expect((ledger[0]?.init?.headers as Headers).get("authorization")).toBe(
      "Bearer synthetic-token",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      method: "GET",
      normalizedPath: "/api/v4/account",
      responseStatus: 200,
      traceId: "trace-123",
      result: "success",
    });
    expect(JSON.stringify(audit[0])).not.toContain("page=2");
  });

  it("does not resolve a bearer token for the OAuth POST", async () => {
    const { fetchFn, request, tokenProvider } = createRequest({
      method: "POST",
      url: "https://555151.amocrm.ru/oauth2/access_token",
      body: "grant_type=authorization_code",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    await expect(amoFetch(request)).resolves.toEqual({ id: 1 });

    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBeNull();
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("runs a final fence callback immediately before the network request", async () => {
    const beforeNetwork = vi.fn(async () => {
      throw new Error("synthetic fence lost");
    });
    const { fetchFn, request, tokenProvider } = createRequest({
      beforeNetwork,
    });

    await expect(amoFetch(request)).rejects.toThrow("E_AMO_UPSTREAM");

    expect(tokenProvider.getAccessToken).toHaveBeenCalledOnce();
    expect(beforeNetwork).toHaveBeenCalledOnce();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("records only safe fields when a response fails schema validation", async () => {
    const { audit, fetchFn, request } = createRequest();
    fetchFn.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: "synthetic-private-value" }), {
        status: 200,
      }),
    );

    await expect(amoFetch(request)).rejects.toThrow("E_AMO_UPSTREAM");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      normalizedPath: "/api/v4/account",
      responseStatus: 200,
      result: "error",
    });
    expect(JSON.stringify(audit[0])).not.toContain("synthetic-private-value");
  });

  it.each([
    [401, "E_AMO_AUTH"],
    [429, "E_AMO_RATE_LIMIT"],
    [503, "E_AMO_UPSTREAM"],
  ])("preserves retryable HTTP status %i without response data", async (status, code) => {
    const { audit, fetchFn, request } = createRequest();
    fetchFn.mockResolvedValue(
      new Response(JSON.stringify({ private: "synthetic-private-value" }), {
        status,
      }),
    );

    const rejection = await amoFetch(request).catch((error: unknown) => error);

    expect(rejection).toMatchObject({ code, responseStatus: status });
    expect(JSON.stringify(rejection)).not.toContain("synthetic-private-value");
    expect(audit).toHaveLength(1);
  });

  it.each([
    ["forbidden method", { method: "PATCH" }, "E_AMO_METHOD_DENIED"],
    [
      "forbidden path",
      { url: "https://555151.amocrm.ru/api/v4/contacts" },
      "E_AMO_PATH_DENIED",
    ],
    [
      "forbidden host",
      { url: "https://example.org/api/v4/leads" },
      "E_AMO_PATH_DENIED",
    ],
    [
      "forbidden protocol",
      { url: "http://555151.amocrm.ru/api/v4/leads" },
      "E_AMO_PATH_DENIED",
    ],
    ["redirect override", { redirect: "follow" }, "E_AMO_PATH_DENIED"],
  ])("keeps %s out of the network", async (_name, overrides, errorCode) => {
    const { audit, fetchFn, ledger, request, tokenProvider } = createRequest(
      overrides,
    );

    await expect(amoFetch(request)).rejects.toThrow(errorCode);

    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      traceId: "trace-123",
      result: "denied",
    });
  });
});
