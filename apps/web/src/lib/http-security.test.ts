import { describe, expect, it } from "vitest";

import {
  getClientIp,
  RequestSecurityError,
  requireSameOrigin,
} from "./http-security";

describe("requireSameOrigin", () => {
  const appUrl = "https://dashboard.real2.example";

  it("accepts the configured origin", () => {
    const request = new Request(`${appUrl}/api/test`, {
      headers: { origin: appUrl },
    });

    expect(() => requireSameOrigin(request, appUrl)).not.toThrow();
  });

  it.each([undefined, "https://evil.example", "not-an-origin"])(
    "rejects a missing, different, or malformed origin: %s",
    (origin) => {
      const request = new Request(
        `${appUrl}/api/test`,
        origin ? { headers: { origin } } : {},
      );

      expect(() => requireSameOrigin(request, appUrl)).toThrow(
        RequestSecurityError,
      );
    },
  );
});

describe("getClientIp", () => {
  it("ignores client-controlled forwarding headers without a trusted proxy boundary", () => {
    const request = new Request("https://dashboard.real2.example", {
      headers: {
        "x-real-ip": "198.51.100.77",
        "x-forwarded-for": "203.0.113.10, 203.0.113.11",
      },
    });

    expect(getClientIp(request)).toBe("unknown");
  });
});
