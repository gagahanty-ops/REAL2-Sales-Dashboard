import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@real2/domain";
import type { TransactionSql } from "postgres";

import type { Database } from "./client.js";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_RETENTION_MS = 24 * 60 * 60_000;
const DISABLED_CIPHERTEXT_BYTES = 64;

export type AmoConnectionStatusValue =
  | "pending"
  | "active"
  | "reauth_required"
  | "disabled";

export type OAuthState = Readonly<{
  createdBy: string;
  redirectAfter: string;
  expiresAt: Date;
}>;

export type CreatedOAuthState = OAuthState & Readonly<{ value: string }>;

export type SafeAmoConnectionStatus = Readonly<{
  id: string;
  accountId: number;
  subdomain: string;
  baseUrl: string;
  tokenExpiresAt: Date;
  status: AmoConnectionStatusValue;
  installedBy: string;
  installedAt: Date;
  refreshedAt: Date | null;
  disabledAt: Date | null;
  updatedAt: Date;
}>;

export type AmoConnectionCredentials = SafeAmoConnectionStatus &
  Readonly<{
    accessTokenCiphertext: Buffer;
    refreshTokenCiphertext: Buffer;
  }>;

export type CreateAmoConnectionInput = Readonly<{
  accountId: number;
  subdomain: string;
  baseUrl: string;
  accessTokenCiphertext: Uint8Array;
  refreshTokenCiphertext: Uint8Array;
  tokenExpiresAt: Date;
  status: AmoConnectionStatusValue;
  installedBy: string;
}>;

type OAuthStateRow = {
  created_by: string;
  redirect_after: string;
  expires_at: Date;
};

type AmoConnectionRow = {
  id: string;
  account_id: string;
  subdomain: string;
  base_url: string;
  access_token_ciphertext: Uint8Array;
  refresh_token_ciphertext: Uint8Array;
  token_expires_at: Date;
  status: AmoConnectionStatusValue;
  installed_by: string;
  installed_at: Date;
  refreshed_at: Date | null;
  disabled_at: Date | null;
  updated_at: Date;
};

type SafeAmoConnectionRow = Omit<
  AmoConnectionRow,
  "access_token_ciphertext" | "refresh_token_ciphertext"
>;

export type LockedAmoConnectionActions = Readonly<{
  rotateTokens(input: {
    accessTokenCiphertext: Uint8Array;
    refreshTokenCiphertext: Uint8Array;
    tokenExpiresAt: Date;
    refreshedAt: Date;
  }): Promise<void>;
  markReauthRequired(at: Date): Promise<void>;
}>;

function stateHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeAccountId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AppError("E_DB", 500);
  }
  return parsed;
}

function mapConnection(row: AmoConnectionRow): AmoConnectionCredentials {
  return {
    id: row.id,
    accountId: safeAccountId(row.account_id),
    subdomain: row.subdomain,
    baseUrl: row.base_url,
    accessTokenCiphertext: Buffer.from(row.access_token_ciphertext),
    refreshTokenCiphertext: Buffer.from(row.refresh_token_ciphertext),
    tokenExpiresAt: row.token_expires_at,
    status: row.status,
    installedBy: row.installed_by,
    installedAt: row.installed_at,
    refreshedAt: row.refreshed_at,
    disabledAt: row.disabled_at,
    updatedAt: row.updated_at,
  };
}

function safeProjection(
  connection: AmoConnectionCredentials,
): SafeAmoConnectionStatus {
  return {
    id: connection.id,
    accountId: connection.accountId,
    subdomain: connection.subdomain,
    baseUrl: connection.baseUrl,
    tokenExpiresAt: connection.tokenExpiresAt,
    status: connection.status,
    installedBy: connection.installedBy,
    installedAt: connection.installedAt,
    refreshedAt: connection.refreshedAt,
    disabledAt: connection.disabledAt,
    updatedAt: connection.updatedAt,
  };
}

function mapSafeConnection(row: SafeAmoConnectionRow): SafeAmoConnectionStatus {
  return {
    id: row.id,
    accountId: safeAccountId(row.account_id),
    subdomain: row.subdomain,
    baseUrl: row.base_url,
    tokenExpiresAt: row.token_expires_at,
    status: row.status,
    installedBy: row.installed_by,
    installedAt: row.installed_at,
    refreshedAt: row.refreshed_at,
    disabledAt: row.disabled_at,
    updatedAt: row.updated_at,
  };
}

async function findConnection(
  db: Database | TransactionSql,
  connectionId: string,
  lock = false,
): Promise<AmoConnectionCredentials | null> {
  const rows = await db.unsafe<AmoConnectionRow[]>(
    `select
      id,
      account_id,
      subdomain,
      base_url,
      access_token_ciphertext,
      refresh_token_ciphertext,
      token_expires_at,
      status,
      installed_by,
      installed_at,
      refreshed_at,
      disabled_at,
      updated_at
    from public.amo_connections
    where id = $1
    limit 1${lock ? " for update" : ""}`,
    [connectionId],
  );
  const row = rows[0];
  return row ? mapConnection(row) : null;
}

export async function createOAuthState(
  db: Database,
  adminUserId: string,
  now = new Date(),
  redirectAfter = "/settings/integrations",
): Promise<CreatedOAuthState> {
  const value = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS);

  await db`
    insert into public.oauth_states (
      state_hash,
      created_by,
      redirect_after,
      expires_at,
      created_at
    ) values (
      ${stateHash(value)},
      ${adminUserId},
      ${redirectAfter},
      ${expiresAt},
      ${now}
    )
  `;

  return { value, createdBy: adminUserId, redirectAfter, expiresAt };
}

export async function consumeOAuthState(
  db: Database,
  value: string,
  now = new Date(),
): Promise<OAuthState> {
  const [row] = await db<OAuthStateRow[]>`
    update public.oauth_states
    set consumed_at = ${now}
    where state_hash = ${stateHash(value)}
      and consumed_at is null
      and expires_at > ${now}
    returning created_by, redirect_after, expires_at
  `;

  if (!row) {
    throw new AppError("E_CONFLICT", 422);
  }

  return {
    createdBy: row.created_by,
    redirectAfter: row.redirect_after,
    expiresAt: row.expires_at,
  };
}

export async function purgeExpiredOAuthStates(
  db: Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - OAUTH_STATE_RETENTION_MS);
  const rows = await db<{ state_hash: string }[]>`
    delete from public.oauth_states
    where expires_at < ${cutoff}
    returning state_hash
  `;
  return rows.length;
}

export async function createAmoConnection(
  db: Database,
  input: CreateAmoConnectionInput,
): Promise<SafeAmoConnectionStatus> {
  const [row] = await db<AmoConnectionRow[]>`
    insert into public.amo_connections (
      account_id,
      subdomain,
      base_url,
      access_token_ciphertext,
      refresh_token_ciphertext,
      token_expires_at,
      status,
      installed_by
    ) values (
      ${input.accountId},
      ${input.subdomain},
      ${input.baseUrl},
      ${Buffer.from(input.accessTokenCiphertext)},
      ${Buffer.from(input.refreshTokenCiphertext)},
      ${input.tokenExpiresAt},
      ${input.status},
      ${input.installedBy}
    )
    returning *
  `;

  if (!row) {
    throw new AppError("E_DB", 500);
  }
  return safeProjection(mapConnection(row));
}

export async function getAmoConnectionCredentials(
  db: Database,
  connectionId: string,
): Promise<AmoConnectionCredentials> {
  const connection = await findConnection(db, connectionId);
  if (!connection) {
    throw new AppError("E_NOT_FOUND", 404);
  }
  return connection;
}

export async function getSafeAmoConnectionStatus(
  db: Database,
  connectionId: string,
): Promise<SafeAmoConnectionStatus> {
  return safeProjection(await getAmoConnectionCredentials(db, connectionId));
}

export async function getCurrentSafeAmoConnectionStatus(
  db: Database,
): Promise<SafeAmoConnectionStatus | null> {
  const [row] = await db<SafeAmoConnectionRow[]>`
    select
      id,
      account_id,
      subdomain,
      base_url,
      token_expires_at,
      status,
      installed_by,
      installed_at,
      refreshed_at,
      disabled_at,
      updated_at
    from public.amo_connections
    where base_url = 'https://555151.amocrm.ru'
    order by updated_at desc, id
    limit 1
  `;
  return row ? mapSafeConnection(row) : null;
}

export async function findDueAmoConnectionIds(
  db: Database,
  cutoff: Date,
): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    select id
    from public.amo_connections
    where status = 'active'
      and token_expires_at <= ${cutoff}
    order by id
  `;
  return rows.map((row) => row.id);
}

export async function withLockedAmoConnection<T>(
  db: Database,
  connectionId: string,
  callback: (
    connection: AmoConnectionCredentials,
    actions: LockedAmoConnectionActions,
  ) => Promise<T>,
): Promise<T> {
  const result = await db.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(hashtextextended(${connectionId}, 0))
    `;
    const connection = await findConnection(transaction, connectionId, true);
    if (!connection) {
      throw new AppError("E_NOT_FOUND", 404);
    }

    const actions: LockedAmoConnectionActions = {
      async rotateTokens(input) {
        await transaction`
          update public.amo_connections
          set
            access_token_ciphertext = ${Buffer.from(input.accessTokenCiphertext)},
            refresh_token_ciphertext = ${Buffer.from(input.refreshTokenCiphertext)},
            token_expires_at = ${input.tokenExpiresAt},
            status = 'active',
            refreshed_at = ${input.refreshedAt},
            disabled_at = null,
            updated_at = ${input.refreshedAt}
          where id = ${connectionId}
        `;
      },
      async markReauthRequired(at) {
        await transaction`
          update public.amo_connections
          set status = 'reauth_required', updated_at = ${at}
          where id = ${connectionId}
        `;
      },
    };

    return { value: await callback(connection, actions) };
  });
  return result.value;
}

export async function disableAmoConnection(
  db: Database,
  connectionId: string,
  now = new Date(),
): Promise<void> {
  const result = await db`
    update public.amo_connections
    set
      access_token_ciphertext = ${randomBytes(DISABLED_CIPHERTEXT_BYTES)},
      refresh_token_ciphertext = ${randomBytes(DISABLED_CIPHERTEXT_BYTES)},
      status = 'disabled',
      disabled_at = ${now},
      updated_at = ${now}
    where id = ${connectionId}
  `;

  if (result.count !== 1) {
    throw new AppError("E_NOT_FOUND", 404);
  }
}
