import type { AppUser } from "@real2/db";

import type { SessionUser } from "./authorization";
import type { LoginRateLimiter } from "./login-rate-limit";

export type LoginCredentials = Readonly<{
  email: string;
  password: string;
  ip: string;
}>;

export interface PasswordAuthenticator {
  signInWithPassword(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface UserDirectory {
  requireActiveUser(authUserId: string): Promise<AppUser>;
}

export class LoginError extends Error {
  readonly code: "E_INVALID_CREDENTIALS" | "E_RATE_LIMITED";
  readonly status: 401 | 429;

  constructor(code: LoginError["code"], status: LoginError["status"]) {
    super(
      code === "E_RATE_LIMITED"
        ? "Слишком много попыток. Попробуйте позже"
        : "Неверный email или пароль",
    );
    this.name = "LoginError";
    this.code = code;
    this.status = status;
  }
}

export async function authenticateCredentials(
  credentials: LoginCredentials,
  dependencies: {
    auth: PasswordAuthenticator;
    directory: UserDirectory;
    limiter: LoginRateLimiter;
  },
): Promise<SessionUser> {
  const email = credentials.email.trim().toLowerCase();

  if (dependencies.limiter.isBlocked(email, credentials.ip)) {
    throw new LoginError("E_RATE_LIMITED", 429);
  }

  const authUserId = await dependencies.auth.signInWithPassword(
    email,
    credentials.password,
  );

  if (!authUserId) {
    dependencies.limiter.registerFailure(email, credentials.ip);
    throw new LoginError("E_INVALID_CREDENTIALS", 401);
  }

  let appUser: AppUser;

  try {
    appUser = await dependencies.directory.requireActiveUser(authUserId);
  } catch {
    await dependencies.auth.signOut();
    dependencies.limiter.registerFailure(email, credentials.ip);
    throw new LoginError("E_INVALID_CREDENTIALS", 401);
  }

  dependencies.limiter.clear(email, credentials.ip);

  return {
    id: appUser.id,
    email: appUser.email,
    fullName: appUser.fullName,
    role: appUser.role,
    amoUserId: appUser.amoUserId,
  };
}
