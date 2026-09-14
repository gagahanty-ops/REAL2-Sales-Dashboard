import postgres, { type Options, type Sql } from "postgres";

export type Database = Sql;

export function createDbClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Database {
  return postgres(databaseUrl, {
    idle_timeout: 20,
    max: 10,
    ...options,
  });
}

export function createServiceWorkerDbClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Database {
  return createDbClient(databaseUrl, {
    ...options,
    connection: {
      ...options.connection,
      role: "service_worker",
    },
  });
}

export async function closeDbClient(db: Database): Promise<void> {
  await db.end({ timeout: 5 });
}
