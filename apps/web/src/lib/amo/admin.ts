import {
  getCurrentSafeAmoConnectionStatus,
  type Database,
  type SafeAmoConnectionStatus,
} from "@real2/db";

import type { PublicAmoConnectionStatus } from "./public-status";

export type { PublicAmoConnectionStatus } from "./public-status";

export function toPublicAmoConnectionStatus(
  connection: SafeAmoConnectionStatus,
): PublicAmoConnectionStatus {
  return {
    accountId: connection.accountId,
    subdomain: connection.subdomain,
    status: connection.status,
    expiresAt: connection.tokenExpiresAt.toISOString(),
    lastCheckedAt: (
      connection.lastCheckedAt ?? connection.installedAt
    ).toISOString(),
  };
}


export async function getCurrentPublicAmoConnectionStatus(
  db: Database,
): Promise<PublicAmoConnectionStatus | null> {
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  return connection ? toPublicAmoConnectionStatus(connection) : null;
}
