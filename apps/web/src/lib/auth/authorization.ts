import type { AppRole } from "@real2/db";

export type SessionUser = Readonly<{
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
}>;

export class AuthorizationError extends Error {
  readonly code = "E_FORBIDDEN" as const;
  readonly status = 403 as const;

  constructor() {
    super("E_FORBIDDEN");
    this.name = "AuthorizationError";
  }
}

export function requireRole<R extends AppRole>(
  user: SessionUser,
  allowed: readonly R[],
  _untrustedInput?: unknown,
): SessionUser & { role: R } {
  void _untrustedInput;
  if (!allowed.includes(user.role as R)) {
    throw new AuthorizationError();
  }

  return user as SessionUser & { role: R };
}
