import { z } from "zod";

import { requireRole } from "../../../../../lib/auth/authorization";
import { createManagedAuthAdmin } from "../../../../../lib/auth/managed-auth-admin";
import {
  requireUser,
  SessionAccessError,
} from "../../../../../lib/auth/require-user";
import {
  updateManagedUser,
  UserAdminError,
} from "../../../../../lib/auth/user-admin";
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

function errorResponse(error: unknown): Response {
  if (error instanceof SessionAccessError) {
    return Response.json(
      { error: { code: error.code, message: "Доступ запрещён" } },
      { status: error.status },
    );
  }
  if (error instanceof UserAdminError) {
    const status = error.code === "E_NOT_FOUND" ? 404 : 409;
    return Response.json(
      { error: { code: error.code, message: "Изменение не выполнено" } },
      { status },
    );
  }

  return Response.json(
    { error: { code: "E_INVALID_REQUEST", message: "Запрос не выполнен" } },
    { status: 400 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    requireRole(await requireUser(), ["admin"]);
    const { id } = await params;
    const input = updateUserSchema.parse(await request.json());
    const db = getDatabase();
    const auth = createManagedAuthAdmin(createAdminSupabaseClient(), db);
    const user = await updateManagedUser(db, auth, id, input);
    return Response.json({ data: user });
  } catch (error) {
    return errorResponse(error);
  }
}
