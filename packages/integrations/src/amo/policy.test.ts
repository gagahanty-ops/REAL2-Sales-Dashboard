import { describe, expect, it } from "vitest";

import { assertAmoRequestAllowed } from "./policy";

describe("assertAmoRequestAllowed", () => {
  it.each([
    ["GET", "/api/v4/account"],
    ["GET", "/api/v4/leads"],
    ["GET", "/api/v4/leads/123"],
    ["GET", "/api/v4/leads/pipelines"],
    ["GET", "/api/v4/leads/pipelines/77/statuses"],
    ["GET", "/api/v4/leads/custom_fields"],
    ["GET", "/api/v4/users"],
    ["GET", "/api/v4/events"],
    ["POST", "/oauth2/access_token"],
  ])("allows %s %s", (method, path) => {
    expect(
      assertAmoRequestAllowed({
        method,
        url: `https://555151.amocrm.ru${path}`,
      }),
    ).toMatchObject({ method, normalizedPath: path });
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])(
    "denies %s on business paths",
    (method) => {
      expect(() =>
        assertAmoRequestAllowed({
          method,
          url: "https://555151.amocrm.ru/api/v4/leads/123",
        }),
      ).toThrowError("E_AMO_METHOD_DENIED");
    },
  );

  it("denies an attacker-controlled host", () => {
    expect(() =>
      assertAmoRequestAllowed({
        method: "GET",
        url: "https://example.org/api/v4/leads",
      }),
    ).toThrowError("E_AMO_PATH_DENIED");
  });
});
