import postgres, { type Sql, type TransactionSql } from "postgres";

export const localDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const localServiceWorkerDatabaseUrl =
  process.env.TEST_SERVICE_WORKER_DATABASE_URL ??
  "postgresql://service_worker:service-worker-test@127.0.0.1:54322/postgres";
export const localRetentionWorkerDatabaseUrl =
  process.env.TEST_RETENTION_WORKER_DATABASE_URL ??
  "postgresql://retention_worker:retention-worker-test@127.0.0.1:54322/postgres";

export type TestAppUser = Readonly<{
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  role: "admin" | "head" | "manager";
  amoUserId: number | null;
  isActive: boolean;
}>;

export const testUsers = {
  admin: {
    id: "10000000-0000-4000-8000-000000000010",
    authUserId: "20000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin",
    amoUserId: null,
    isActive: true,
  },
  head: {
    id: "10000000-0000-4000-8000-000000000020",
    authUserId: "20000000-0000-4000-8000-000000000020",
    email: "head@example.test",
    fullName: "Head User",
    role: "head",
    amoUserId: null,
    isActive: true,
  },
  managerOne: {
    id: "10000000-0000-4000-8000-000000000001",
    authUserId: "20000000-0000-4000-8000-000000000001",
    email: "manager.one@example.test",
    fullName: "Manager One",
    role: "manager",
    amoUserId: 101,
    isActive: true,
  },
  managerTwo: {
    id: "10000000-0000-4000-8000-000000000002",
    authUserId: "20000000-0000-4000-8000-000000000002",
    email: "manager.two@example.test",
    fullName: "Manager Two",
    role: "manager",
    amoUserId: 102,
    isActive: true,
  },
  inactiveManager: {
    id: "10000000-0000-4000-8000-000000000003",
    authUserId: "20000000-0000-4000-8000-000000000003",
    email: "inactive.manager@example.test",
    fullName: "Inactive Manager",
    role: "manager",
    amoUserId: 103,
    isActive: false,
  },
} as const satisfies Record<string, TestAppUser>;

export function createAdminDb(): Sql {
  return postgres(localDatabaseUrl, { max: 1 });
}

export async function ensureRestrictedTestLogins(db: Sql): Promise<void> {
  await db.unsafe("alter role service_worker login password 'service-worker-test'");
  await db.unsafe("alter role retention_worker login password 'retention-worker-test'");
}

export async function resetAndSeedUsers(
  db: Sql,
  users: readonly TestAppUser[],
): Promise<void> {
  await db`delete from app_users`;

  for (const user of users) {
    await db`
      insert into auth.users (id, email)
      values (${user.authUserId}, ${user.email})
      on conflict (id) do update set email = excluded.email
    `;
    await db`
      insert into app_users (
        id,
        auth_user_id,
        email,
        full_name,
        role,
        amo_user_id,
        is_active
      ) values (
        ${user.id},
        ${user.authUserId},
        ${user.email},
        ${user.fullName},
        ${user.role},
        ${user.amoUserId},
        ${user.isActive}
      )
    `;
  }
}

async function assumeRole(
  db: TransactionSql,
  role: "anon" | "authenticated",
  authUserId?: string,
): Promise<void> {
  await db.unsafe(`set local role ${role}`);
  await db`select set_config('request.jwt.claim.sub', ${authUserId ?? ""}, true)`;
}

export async function visibleAppUserIds(
  db: Sql,
  role: "anon" | "authenticated",
  authUserId?: string,
): Promise<string[]> {
  return db.begin(async (transaction) => {
    await assumeRole(transaction, role, authUserId);
    const rows = await transaction<{ id: string }[]>`
      select id from app_users order by email
    `;
    return rows.map((row) => row.id);
  });
}

export async function visibleControlKeys(
  db: Sql,
  authUserId: string,
): Promise<string[]> {
  return db.begin(async (transaction) => {
    await assumeRole(transaction, "authenticated", authUserId);
    const rows = await transaction<{ key: string }[]>`
      select key from system_controls order by key
    `;
    return rows.map((row) => row.key);
  });
}

export async function updateOwnNameAsManager(
  db: Sql,
  manager: TestAppUser,
): Promise<void> {
  await db.begin(async (transaction) => {
    await assumeRole(transaction, "authenticated", manager.authUserId);
    await transaction`
      update app_users
      set full_name = 'Tampered Name'
      where id = ${manager.id}
    `;
  });
}
