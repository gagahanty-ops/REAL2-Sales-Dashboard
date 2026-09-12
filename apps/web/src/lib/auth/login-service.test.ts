import { describe, expect, it } from "vitest";

import type { AppUser } from "@real2/db";
import { LoginRateLimiter } from "./login-rate-limit";
import {
  authenticateCredentials,
  type PasswordAuthenticator,
  type UserDirectory,
} from "./login-service";

const activeUser: AppUser = {
  id: "10000000-0000-4000-8000-000000000001",
  authUserId: "20000000-0000-4000-8000-000000000001",
  email: "manager@example.test",
  fullName: "Manager User",
  role: "manager",
  amoUserId: 101,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function createAuthenticator(authUserId: string | null): PasswordAuthenticator & {
  signOutCalls: number;
} {
  return {
    signOutCalls: 0,
    async signInWithPassword() {
      return authUserId;
    },
    async signOut() {
      this.signOutCalls += 1;
    },
  };
}

describe("authenticateCredentials", () => {
  it("returns a session user and clears failures after success", async () => {
    const auth = createAuthenticator(activeUser.authUserId);
    const directory: UserDirectory = {
      async requireActiveUser() {
        return activeUser;
      },
    };
    const limiter = new LoginRateLimiter(() => 0);
    limiter.registerFailure(activeUser.email, "192.0.2.10");

    await expect(
      authenticateCredentials(
        {
          email: activeUser.email,
          password: "Local-password-123!",
          ip: "192.0.2.10",
        },
        { auth, directory, limiter },
      ),
    ).resolves.toEqual({
      id: activeUser.id,
      email: activeUser.email,
      fullName: activeUser.fullName,
      role: activeUser.role,
      amoUserId: activeUser.amoUserId,
    });
    expect(
      limiter.registerFailure(activeUser.email, "192.0.2.10").failureCount,
    ).toBe(1);
  });

  it("uses the same safe error for invalid credentials and missing allowlist", async () => {
    const invalidAuth = createAuthenticator(null);
    const validAuth = createAuthenticator(activeUser.authUserId);
    const missingDirectory: UserDirectory = {
      async requireActiveUser() {
        throw new Error("private database detail");
      },
    };
    const limiter = new LoginRateLimiter(() => 0);

    const invalidCredentials = authenticateCredentials(
      {
        email: activeUser.email,
        password: "wrong-password",
        ip: "192.0.2.10",
      },
      { auth: invalidAuth, directory: missingDirectory, limiter },
    );
    const missingAllowlist = authenticateCredentials(
      {
        email: activeUser.email,
        password: "valid-password",
        ip: "192.0.2.11",
      },
      { auth: validAuth, directory: missingDirectory, limiter },
    );

    await expect(invalidCredentials).rejects.toMatchObject({
      code: "E_INVALID_CREDENTIALS",
      message: "Неверный email или пароль",
    });
    await expect(missingAllowlist).rejects.toMatchObject({
      code: "E_INVALID_CREDENTIALS",
      message: "Неверный email или пароль",
    });
    expect(validAuth.signOutCalls).toBe(1);
  });
});
