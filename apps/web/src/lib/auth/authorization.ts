import type { AppRole } from "@real2/db";
import { AppError } from "@real2/domain";

export type SessionUser = Readonly<{
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
}>;

export class AuthorizationError extends AppError {
  constructor() {
    super("E_FORBIDDEN", 403);
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
