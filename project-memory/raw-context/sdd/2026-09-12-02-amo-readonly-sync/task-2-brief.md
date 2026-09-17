### Task 2: Store encrypted OAuth state and rotating tokens

**Files:**
- Create: `supabase/migrations/0002_amo_oauth.sql`
- Create: `packages/integrations/src/amo/crypto.ts`
- Create: `packages/integrations/src/amo/oauth.ts`
- Create: `packages/db/src/amo-connections.ts`
- Create: `apps/worker/src/jobs/refresh-amo-token.ts`
- Create: `packages/integrations/src/amo/oauth.test.ts`
- Modify: `packages/domain/src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`, `AMO_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`.
- Produces: `createOAuthState(adminUserId)`, `consumeOAuthState(state)`, `exchangeAuthorizationCode(code)`, `refreshConnection(connectionId)`, `refreshDueConnections(now)`, and `AmoTokenProvider`.

- [ ] **Step 1: Write failing single-use and redaction tests**

```ts
it("consumes an OAuth state exactly once within ten minutes", async () => {
  const state = await store.createOAuthState(adminId, now);
  await expect(store.consumeOAuthState(state.value, now.plus({ minutes: 9 }))).resolves.toMatchObject({ createdBy: adminId });
  await expect(store.consumeOAuthState(state.value, now.plus({ minutes: 9 }))).rejects.toThrow("E_CONFLICT");
});

it("never serializes decrypted tokens", async () => {
  const connection = await repository.getSafeStatus(connectionId);
  expect(JSON.stringify(connection)).not.toMatch(/access_token|refresh_token|synthetic-secret/i);
});
```

- [ ] **Step 2: Run tests and verify the storage functions are missing**

Run: `pnpm vitest run packages/integrations/src/amo/oauth.test.ts`

Expected: FAIL on missing OAuth modules.

- [ ] **Step 3: Add OAuth tables and application encryption**

```sql
create type connection_status as enum ('pending', 'active', 'reauth_required', 'disabled');

create table oauth_states (
  state_hash text primary key,
  created_by uuid not null references app_users(id),
  redirect_after text not null default '/settings/integrations',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table amo_connections (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null unique,
  subdomain text not null unique check (subdomain ~ '^[a-z0-9-]+$'),
  base_url text not null,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expires_at timestamptz not null,
  status connection_status not null,
  installed_by uuid not null references app_users(id),
  installed_at timestamptz not null default now(),
  refreshed_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table oauth_states enable row level security;
alter table amo_connections enable row level security;
```

AES-256-GCM encrypts each token with a 32-byte key supplied by the secret store; each ciphertext blob includes its own random IV and authentication tag. The refresh transaction locks the connection row, exchanges the current refresh token, encrypts the new pair, updates `token_expires_at` and `refreshed_at`, and commits before returning an access token to server code. `refreshDueConnections(now)` selects active connections expiring within ten minutes and refreshes each under the same lock. A refresh failure sets `reauth_required` and prevents new sync runs. Disabled connections overwrite both ciphertext columns with cryptographically random bytes and set `disabled_at`; expired OAuth states are purged 24 hours after expiry.

- [ ] **Step 4: Verify expiry, replay, rotation, concurrency, and log redaction**

Run: `supabase db reset && pnpm vitest run packages/integrations/src/amo/oauth.test.ts && pnpm test:security`

Expected: PASS; expired/replayed states fail; proactive refresh starts at the ten-minute boundary; concurrent refresh makes one upstream POST; refresh failure sets `reauth_required`; logs contain no code or token.

- [ ] **Step 5: Commit OAuth persistence**

```bash
git add supabase/migrations/0002_amo_oauth.sql packages/integrations packages/db packages/domain/src/env.ts apps/worker/src/jobs/refresh-amo-token.ts .env.example
git commit -m "feat: secure amoCRM OAuth credentials"
```

