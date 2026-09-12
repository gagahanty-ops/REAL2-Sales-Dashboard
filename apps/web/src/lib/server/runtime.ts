import { createDbClient, type Database } from "@real2/db";
import { parseServerEnv, type ServerEnv } from "@real2/domain";

let cachedEnv: ServerEnv | undefined;
let cachedDatabase: Database | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

export function getDatabase(): Database {
  cachedDatabase ??= createDbClient(getServerEnv().DATABASE_URL);
  return cachedDatabase;
}
