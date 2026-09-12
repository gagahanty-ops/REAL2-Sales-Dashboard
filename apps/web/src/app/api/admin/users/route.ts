import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { createManagedAuthAdmin } from "../../../../lib/auth/managed-auth-admin";
import { requireUser, SessionAccessError } from "../../../../lib/auth/require-user";
import {
  createManagedUser,
  listManagedUsers,
  UserAdminError,
} from "../../../../lib/auth/user-admin";
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

async function requireAdmin(): Promise<void> {
  requireRole(await requireUser(), ["admin"]);
}

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    return Response.json({ data: await listManagedUsers(getDatabase()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    await requireAdmin();
    const input = createUserSchema.parse(await request.json());
    const db = getDatabase();
    const auth = createManagedAuthAdmin(createAdminSupabaseClient(), db);
    const user = await createManagedUser(db, auth, input);
    return Response.json({ data: user }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
