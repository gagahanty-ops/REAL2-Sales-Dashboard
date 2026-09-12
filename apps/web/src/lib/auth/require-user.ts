import { requireActiveAppUser } from "@real2/db";

import type { SessionUser } from "./authorization";
import { getDatabase } from "../server/runtime";
import { createRequestSupabaseClient } from "../supabase/server";

export class SessionAccessError extends Error {
  readonly code: "E_UNAUTHENTICATED" | "E_FORBIDDEN";
  readonly status: 401 | 403;

  constructor(
    code: SessionAccessError["code"],
    status: SessionAccessError["status"],
  ) {
    super(code);
    this.name = "SessionAccessError";
    this.code = code;
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const supabase = await createRequestSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new SessionAccessError("E_UNAUTHENTICATED", 401);
  }

  try {
    const appUser = await requireActiveAppUser(getDatabase(), data.user.id);

    return {
      id: appUser.id,
      email: appUser.email,
      fullName: appUser.fullName,
      role: appUser.role,
      amoUserId: appUser.amoUserId,
    };
  } catch {
    throw new SessionAccessError("E_FORBIDDEN", 403);
  }
}
