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
  it("prefers the proxy-verified real IP and bounds its length", () => {
    const longIp = "1".repeat(100);
    const request = new Request("https://dashboard.real2.example", {
      headers: {
        "x-real-ip": longIp,
        "x-forwarded-for": "203.0.113.10, 203.0.113.11",
      },
    });

    expect(getClientIp(request)).toBe("1".repeat(64));
  });

  it("uses the first forwarded address when real IP is absent", () => {
    const request = new Request("https://dashboard.real2.example", {
      headers: { "x-forwarded-for": "203.0.113.10, 203.0.113.11" },
    });

    expect(getClientIp(request)).toBe("203.0.113.10");
  });
});
