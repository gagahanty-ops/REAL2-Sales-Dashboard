import postgres, { type Options, type Sql } from "postgres";

import { AppError } from "@real2/domain";

export type Database = Sql;

function restrictedLogin(
  databaseUrl: string,
  expectedUsername: "service_worker" | "retention_worker",
  label: string,
): void {
  let username: string;
  try {
    username = new URL(databaseUrl).username;
  } catch {
    throw new AppError("E_CONFIG_INCOMPLETE", 500, `${label} is not a valid PostgreSQL URL`);
  }
  if (username !== expectedUsername) {
    throw new AppError(
      "E_CONFIG_INCOMPLETE",
      500,
      `${label} must authenticate as ${expectedUsername}`,
    );
  }
}

function rejectSetRole(
  options: Options<Record<string, never>>,
  label: string,
): void {
  const role = (options.connection as { role?: unknown } | undefined)?.role;
  if (role !== undefined) {
    throw new AppError(
      "E_CONFIG_INCOMPLETE",
      500,
      `${label} must not use SET ROLE escalation`,
    );
  }
}

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
  restrictedLogin(databaseUrl, "service_worker", "WORKER_DATABASE_URL");
  rejectSetRole(options, "WORKER_DATABASE_URL");
  return createDbClient(databaseUrl, options);
}

export function createRetentionWorkerDbClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Database {
  restrictedLogin(databaseUrl, "retention_worker", "RETENTION_DATABASE_URL");
  rejectSetRole(options, "RETENTION_DATABASE_URL");
  return createDbClient(databaseUrl, options);
}

export async function closeDbClient(db: Database): Promise<void> {
  await db.end({ timeout: 5 });
}
