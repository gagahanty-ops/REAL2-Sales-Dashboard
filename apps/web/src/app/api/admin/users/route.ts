import { z } from "zod";
import { success } from "@real2/domain";

import { requireRole } from "../../../../lib/auth/authorization";
import { createManagedAuthAdmin } from "../../../../lib/auth/managed-auth-admin";
import { requireUser } from "../../../../lib/auth/require-user";
import {
  createManagedUser,
  listManagedUsers,
  toUserAdminAppError,
  UserAdminError,
} from "../../../../lib/auth/user-admin";
import { readJson, withRoute } from "../../../../lib/http/route";
import { requireSameOrigin } from "../../../../lib/http-security";
import { getDatabase } from "../../../../lib/server/runtime";
import { createAdminSupabaseClient } from "../../../../lib/supabase/server";

const roleSchema = z.enum(["admin", "head", "manager"]);
const createUserSchema = z
  .strictObject({
    email: z.email().max(254),
    password: z.string().min(12).max(512),
    fullName: z.string().trim().min(2).max(120),
    role: roleSchema,
    amoUserId: z.number().int().positive().nullable(),
  })
  .superRefine((value, context) => {
    if (value.role === "manager" && value.amoUserId === null) {
      context.addIssue({
        code: "custom",
        message: "amoUserId is required for a manager",
        path: ["amoUserId"],
      });
    }
  });

async function requireAdmin(): Promise<void> {
  requireRole(await requireUser(), ["admin"]);
}

export const GET = withRoute(async () => {
  await requireAdmin();
  return listManagedUsers(getDatabase());
});

export const POST = withRoute(async (request, context) => {
  requireSameOrigin(request);
  await requireAdmin();
  const input = createUserSchema.parse(await readJson(request));
  const db = getDatabase();
  const auth = createManagedAuthAdmin(createAdminSupabaseClient(), db);

  try {
    const user = await createManagedUser(db, auth, input);
    return Response.json(success(user, { trace_id: context.traceId }), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof UserAdminError) throw toUserAdminAppError(error);
    throw error;
  }
});
