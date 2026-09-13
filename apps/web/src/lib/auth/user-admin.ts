import {
  findAppUserByAuthId,
  type AppRole,
  type AppUser,
  type Database,
} from "@real2/db";
import { AppError } from "@real2/domain";

export type CreateManagedUserInput = Readonly<{
  email: string;
  password: string;
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
}>;

export type UpdateManagedUserInput = Readonly<{
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
  isActive: boolean;
  expectedUpdatedAt: string;
}>;

export interface ManagedAuthAdmin {
  createUser(input: {
    email: string;
    password: string;
  }): Promise<{ id: string }>;
  deleteUser(authUserId: string): Promise<void>;
  revokeSessions(authUserId: string): Promise<void>;
}

export class UserAdminError extends Error {
  readonly code:
    | "E_CONFLICT"
    | "E_LAST_ADMIN"
    | "E_NOT_FOUND"
    | "E_CONFIGURATION";

  constructor(code: UserAdminError["code"]) {
    super(code);
    this.name = "UserAdminError";
    this.code = code;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export function toUserAdminAppError(error: UserAdminError): AppError {
  switch (error.code) {
    case "E_NOT_FOUND":
      return new AppError("E_NOT_FOUND", 404);
    case "E_CONFLICT":
      return new AppError("E_CONFLICT", 409);
    case "E_LAST_ADMIN":
      return new AppError(
        "E_CONFLICT",
        409,
        "Нельзя отключить или понизить последнего администратора",
      );
    case "E_CONFIGURATION":
      return new AppError("E_INTERNAL", 500);
  }
}

export async function createManagedUser(
  db: Database,
  auth: ManagedAuthAdmin,
  input: CreateManagedUserInput,
): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const authUser = await auth.createUser({ email, password: input.password });

  try {
    await db`
      insert into public.app_users (
        auth_user_id,
        email,
        full_name,
        role,
        amo_user_id
      ) values (
        ${authUser.id},
        ${email},
        ${input.fullName.trim()},
        ${input.role},
        ${input.amoUserId}
      )
    `;
  } catch (error) {
    await auth.deleteUser(authUser.id);
    if (isUniqueConstraintError(error)) {
      throw new UserAdminError("E_CONFLICT");
    }
    throw error;
  }

  const user = await findAppUserByAuthId(db, authUser.id);

  if (!user) {
    throw new UserAdminError("E_CONFIGURATION");
  }

  return user;
}

export async function updateManagedUser(
  db: Database,
  auth: ManagedAuthAdmin,
  appUserId: string,
  input: UpdateManagedUserInput,
): Promise<AppUser> {
  const updateResult = await db.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(hashtext('app_users:last-active-admin'))
    `;

    const [current] = await transaction<
      {
        auth_user_id: string;
        role: AppRole;
        is_active: boolean;
        updated_at: Date;
      }[]
    >`
      select auth_user_id, role, is_active, updated_at
      from public.app_users
      where id = ${appUserId}
      for update
    `;

    if (!current) throw new UserAdminError("E_NOT_FOUND");

    const expectedUpdatedAt = Date.parse(input.expectedUpdatedAt);
    if (
      !Number.isFinite(expectedUpdatedAt) ||
      current.updated_at.getTime() !== expectedUpdatedAt
    ) {
      throw new UserAdminError("E_CONFLICT");
    }

    const removesActiveAdmin =
      current.role === "admin" &&
      current.is_active &&
      (input.role !== "admin" || !input.isActive);

    if (removesActiveAdmin) {
      const [countRow] = await transaction<{ count: string }[]>`
        select count(*)::text as count
        from public.app_users
        where role = 'admin' and is_active
      `;

      if (!countRow) throw new UserAdminError("E_CONFIGURATION");

      if (Number(countRow.count) <= 1) {
        throw new UserAdminError("E_LAST_ADMIN");
      }
    }

    await transaction`
      update public.app_users
      set
        full_name = ${input.fullName.trim()},
        role = ${input.role},
        amo_user_id = ${input.amoUserId},
        is_active = ${input.isActive},
        updated_at = greatest(
          date_trunc('milliseconds', clock_timestamp()),
          updated_at + interval '1 millisecond'
        )
      where id = ${appUserId}
    `;

    return {
      authUserId: current.auth_user_id,
      revokeSessions:
        current.role !== input.role || current.is_active !== input.isActive,
    };
  });

  if (updateResult.revokeSessions) {
    await auth.revokeSessions(updateResult.authUserId);
  }

  const user = await findAppUserByAuthId(db, updateResult.authUserId);

  if (!user) {
    throw new UserAdminError("E_CONFIGURATION");
  }

  return user;
}

export async function listManagedUsers(db: Database): Promise<AppUser[]> {
  const rows = await db<{ auth_user_id: string }[]>`
    select auth_user_id
    from public.app_users
    order by full_name, id
  `;
  const users = await Promise.all(
    rows.map((row) => findAppUserByAuthId(db, row.auth_user_id)),
  );

  return users.filter((user): user is AppUser => user !== null);
}
