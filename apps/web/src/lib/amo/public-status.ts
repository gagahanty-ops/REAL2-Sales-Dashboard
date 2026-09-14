export type PublicAmoConnectionStatus = Readonly<{
  accountId: number;
  subdomain: string;
  status: "pending" | "active" | "reauth_required" | "disabled";
  expiresAt: string;
  lastCheckedAt: string;
}>;

export function isAmoConnectionActive(
  connection: PublicAmoConnectionStatus | null,
): boolean {
  return connection?.status === "active";
}
