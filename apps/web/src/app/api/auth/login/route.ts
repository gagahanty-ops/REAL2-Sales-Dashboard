import { z } from "zod";

import { requireActiveAppUser } from "@real2/db";
import { AppError } from "@real2/domain";
import { getClientIp, requireSameOrigin } from "../../../../lib/http-security";
import { LoginRateLimiter } from "../../../../lib/auth/login-rate-limit";
import {
  authenticateCredentials,
  LoginError,
} from "../../../../lib/auth/login-service";
import { getDatabase } from "../../../../lib/server/runtime";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";
import { withRoute } from "../../../../lib/http/route";

const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(512),
});

const limiter = new LoginRateLimiter();

export const POST = withRoute(async (request) => {
  requireSameOrigin(request);
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw new LoginError("E_INVALID_CREDENTIALS", 401);

  const supabase = await createRequestSupabaseClient();
  try {
    return await authenticateCredentials(
      { ...parsed.data, ip: getClientIp(request) },
      {
        limiter,
        auth: {
          async signInWithPassword(email, password) {
            const { data, error } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            return error ? null : (data.user?.id ?? null);
          },
          async signOut() {
            await supabase.auth.signOut({ scope: "local" });
          },
        },
        directory: {
          async requireActiveUser(authUserId) {
            return requireActiveAppUser(getDatabase(), authUserId);
          },
        },
      },
    );
  } catch (error) {
    if (error instanceof LoginError) {
      throw new AppError(
        error.code === "E_RATE_LIMITED" ? "E_RATE_LIMITED" : "E_AUTH_REQUIRED",
        error.status,
        error.message,
      );
    }
    throw error;
  }
});
