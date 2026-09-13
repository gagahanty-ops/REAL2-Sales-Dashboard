import { describe, expect, it } from "vitest";

import {
  getClientIp,
  RequestSecurityError,
  requireSameOrigin,
} from "./http-security";
import { loginRatePolicy } from "./auth/login-rate-limit";

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
  it("uses one loopback key in an explicitly local deployment", () => {
    const request = new Request("https://dashboard.real2.example", {
      headers: {
        "x-real-ip": "198.51.100.77",
        "x-forwarded-for": "203.0.113.10, 203.0.113.11",
      },
    });

    expect(
      getClientIp(request, { appUrl: "http://127.0.0.1:3000" }),
    ).toBe("loopback");
  });

  it("rejects forwarding headers when a non-local proxy boundary is absent", () => {
    const request = new Request("https://dashboard.real2.example", {
      headers: { "x-real-ip": "198.51.100.77" },
    });

    expect(() =>
      getClientIp(request, { appUrl: "https://dashboard.real2.example" }),
    ).toThrow(RequestSecurityError);
  });

  it("accepts distinct validated IPs only from the configured trusted proxy", () => {
    const trustedProxySecret = "p".repeat(32);
    const options = {
      appUrl: "https://dashboard.real2.example",
      trustedProxySecret,
    };
    const requestFrom = (ip: string, secret = trustedProxySecret) =>
      new Request("https://dashboard.real2.example", {
        headers: {
          "x-real-ip": ip,
          "x-real2-proxy-secret": secret,
        },
      });

    const firstIp = getClientIp(requestFrom("198.51.100.77"), options);
    const secondIp = getClientIp(requestFrom("203.0.113.10"), options);

    expect(firstIp).toBe("198.51.100.77");
    expect(secondIp).toBe("203.0.113.10");
    expect(loginRatePolicy.key("user@example.test", firstIp)).not.toBe(
      loginRatePolicy.key("user@example.test", secondIp),
    );
    expect(() =>
      getClientIp(requestFrom("198.51.100.77", "attacker-secret"), options),
    ).toThrow(RequestSecurityError);
  });
});
