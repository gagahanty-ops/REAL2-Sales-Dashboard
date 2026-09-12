import { z } from "zod";

import { requireActiveAppUser } from "@real2/db";
import { getClientIp, requireSameOrigin } from "../../../../lib/http-security";
import { LoginRateLimiter } from "../../../../lib/auth/login-rate-limit";
import {
  authenticateCredentials,
  LoginError,
} from "../../../../lib/auth/login-service";
import { getDatabase } from "../../../../lib/server/runtime";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";

const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(512),
});

const limiter = new LoginRateLimiter();

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) throw new LoginError("E_INVALID_CREDENTIALS", 401);

    const supabase = await createRequestSupabaseClient();
    const user = await authenticateCredentials(
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

    return Response.json({ data: user });
  } catch (error) {
    if (error instanceof LoginError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    return Response.json(
      { error: { code: "E_FORBIDDEN", message: "Запрос отклонён" } },
      { status: 403 },
    );
  }
}
