import { requireActiveAppUser } from "@real2/db";
import { AppError } from "@real2/domain";

import type { SessionUser } from "./authorization";
import { getDatabase } from "../server/runtime";
import { createRequestSupabaseClient } from "../supabase/server";

export class SessionAccessError extends AppError {
  constructor(code: "E_AUTH_REQUIRED" | "E_FORBIDDEN", status: 401 | 403) {
    super(code, status);
    this.name = "SessionAccessError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const supabase = await createRequestSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new SessionAccessError("E_AUTH_REQUIRED", 401);
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
