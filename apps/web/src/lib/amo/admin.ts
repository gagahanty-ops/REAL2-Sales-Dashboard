import {
  getCurrentSafeAmoConnectionStatus,
  type Database,
  type SafeAmoConnectionStatus,
} from "@real2/db";

export type PublicAmoConnectionStatus = Readonly<{
  accountId: number;
  subdomain: string;
  status: SafeAmoConnectionStatus["status"];
  expiresAt: string;
  lastCheckedAt: string;
}>;

export function toPublicAmoConnectionStatus(
  connection: SafeAmoConnectionStatus,
): PublicAmoConnectionStatus {
  return {
    accountId: connection.accountId,
    subdomain: connection.subdomain,
    status: connection.status,
    expiresAt: connection.tokenExpiresAt.toISOString(),
    lastCheckedAt: (
      connection.refreshedAt ?? connection.installedAt
    ).toISOString(),
  };
}

export async function getCurrentPublicAmoConnectionStatus(
  db: Database,
): Promise<PublicAmoConnectionStatus | null> {
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  return connection ? toPublicAmoConnectionStatus(connection) : null;
}
