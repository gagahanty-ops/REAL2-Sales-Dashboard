import { z } from "zod";

import { requireRole } from "../../../../../lib/auth/authorization";
import { createManagedAuthAdmin } from "../../../../../lib/auth/managed-auth-admin";
import {
  requireUser,
} from "../../../../../lib/auth/require-user";
import {
  toUserAdminAppError,
  updateManagedUser,
  UserAdminError,
} from "../../../../../lib/auth/user-admin";
import { readJson, withRoute } from "../../../../../lib/http/route";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { getDatabase } from "../../../../../lib/server/runtime";
import { createAdminSupabaseClient } from "../../../../../lib/supabase/server";

const updateUserSchema = z
  .strictObject({
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(["admin", "head", "manager"]),
    amoUserId: z.number().int().positive().nullable(),
    isActive: z.boolean(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
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

type UserRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withRoute<unknown, UserRouteContext>(async (
  request,
  context,
) => {
  try {
    requireSameOrigin(request);
    requireRole(await requireUser(), ["admin"]);
    const routeContext = context.routeContext;
    if (!routeContext) throw new UserAdminError("E_NOT_FOUND");
    const { id } = await routeContext.params;
    const input = updateUserSchema.parse(await readJson(request));
    const db = getDatabase();
    const auth = createManagedAuthAdmin(createAdminSupabaseClient(), db);
    return await updateManagedUser(db, auth, id, input);
  } catch (error) {
    if (error instanceof UserAdminError) throw toUserAdminAppError(error);
    throw error;
  }
});
