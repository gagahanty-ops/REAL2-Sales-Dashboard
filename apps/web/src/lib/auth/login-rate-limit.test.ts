import { describe, expect, it } from "vitest";

import { LoginRateLimiter } from "./login-rate-limit";

describe("LoginRateLimiter", () => {
  it("blocks the fifth failure for one normalized email and IP", () => {
    let now = Date.parse("2026-09-12T10:00:00.000Z");
    const limiter = new LoginRateLimiter(() => now);

    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(
        limiter.registerFailure("  USER@Example.Test ", "192.0.2.10"),
      ).toMatchObject({ blocked: false, failureCount: attempt });
    }

    expect(
      limiter.registerFailure("user@example.test", "192.0.2.10"),
    ).toMatchObject({ blocked: true, failureCount: 5 });
    expect(limiter.isBlocked("USER@example.test", "192.0.2.10")).toBe(true);

    now += 15 * 60 * 1000;
    expect(limiter.isBlocked("user@example.test", "192.0.2.10")).toBe(false);
  });

  it("does not block another IP for the same email", () => {
    const limiter = new LoginRateLimiter(() => 0);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.registerFailure("user@example.test", "192.0.2.10");
    }

    expect(limiter.isBlocked("user@example.test", "192.0.2.11")).toBe(false);
  });

  it("clears failures after a successful login", () => {
    const limiter = new LoginRateLimiter(() => 0);

    limiter.registerFailure("user@example.test", "192.0.2.10");
    limiter.clear("user@example.test", "192.0.2.10");

    expect(
      limiter.registerFailure("user@example.test", "192.0.2.10"),
    ).toMatchObject({ blocked: false, failureCount: 1 });
  });
});
