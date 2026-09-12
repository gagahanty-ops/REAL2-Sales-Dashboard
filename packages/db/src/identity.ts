import type { Database } from "./client.js";

export type AppRole = "admin" | "head" | "manager";

export type AppUser = Readonly<{
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SystemControlKey = "sync_enabled" | "sheet_publish_enabled";

export type SystemControl = Readonly<{
  key: SystemControlKey;
  enabled: boolean;
  reason: string;
  updatedBy: string | null;
  updatedAt: Date;
}>;

type AppUserRow = {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string;
  role: AppRole;
  amo_user_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type SystemControlRow = {
  key: SystemControlKey;
  enabled: boolean;
  reason: string;
  updated_by: string | null;
  updated_at: Date;
};

export class AppIdentityError extends Error {
  readonly code: "E_FORBIDDEN" | "E_CONFIGURATION";

  constructor(code: "E_FORBIDDEN" | "E_CONFIGURATION") {
    super(code);
    this.name = "AppIdentityError";
    this.code = code;
  }
}

function mapAppUser(row: AppUserRow): AppUser {
  const amoUserId = row.amo_user_id === null ? null : Number(row.amo_user_id);

  if (amoUserId !== null && !Number.isSafeInteger(amoUserId)) {
    throw new AppIdentityError("E_CONFIGURATION");
  }

  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    amoUserId,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findAppUserByAuthId(
  db: Database,
  authUserId: string,
): Promise<AppUser | null> {
  const [row] = await db<AppUserRow[]>`
    select
      id,
      auth_user_id,
      email::text,
      full_name,
      role,
      amo_user_id,
      is_active,
      created_at,
      updated_at
    from public.app_users
    where auth_user_id::text = ${authUserId}
    limit 1
  `;

  return row ? mapAppUser(row) : null;
}

export async function requireActiveAppUser(
  db: Database,
  authUserId: string,
): Promise<AppUser> {
  const user = await findAppUserByAuthId(db, authUserId);

  if (!user?.isActive) {
    throw new AppIdentityError("E_FORBIDDEN");
  }

  return user;
}

export async function getSystemControl(
  db: Database,
  key: SystemControlKey,
): Promise<SystemControl> {
  const [row] = await db<SystemControlRow[]>`
    select key, enabled, reason, updated_by, updated_at
    from public.system_controls
    where key = ${key}
    limit 1
  `;

  if (!row) {
    throw new AppIdentityError("E_CONFIGURATION");
  }

  return {
    key: row.key,
    enabled: row.enabled,
    reason: row.reason,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
