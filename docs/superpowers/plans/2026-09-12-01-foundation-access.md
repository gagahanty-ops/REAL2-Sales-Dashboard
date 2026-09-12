# REAL2 Foundation and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a runnable monorepo with validated configuration, PostgreSQL migrations/RLS, private Supabase authentication, safe API responses, and local web/worker containers.

**Architecture:** The web and worker processes share small workspace packages. Supabase Auth establishes identity, PostgreSQL RLS enforces row scope, and every API response uses one safe envelope with a trace ID. No external amoCRM or Google credential is required in this plan.

**Tech Stack:** Node.js 22 LTS, pnpm 10, Next.js 16, React 19, TypeScript 5.9, Zod 4, Supabase Pro/PostgreSQL 16, Vitest, PGlite, Playwright, Docker Compose.

**Spec:** `SPEC.md` sections 0 and M1; `SECURITY_READ_ONLY.md` sections 6–8.

## Global Constraints

- Use the exact workspace boundaries in the master roadmap.
- `admin`, `head`, and `manager` are the only interactive roles.
- Public registration is disabled; inactive users receive 403.
- Role and manager scope come from the server session and database, never request parameters.
- RLS defaults to deny and has explicit negative tests against existing rows.
- Secrets are server-only and validated without printing their values.
- All production switches are false by default.

---

### Task 1: Scaffold the monorepo and executable quality commands

**Files:**
- Create: `package.json`
- Create: `.nvmrc`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/main.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/db/package.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/integrations/package.json`
- Create: `packages/integrations/src/index.ts`
- Create: `packages/testkit/package.json`
- Create: `packages/testkit/src/index.ts`
- Test: `tests/repo/workspace.test.mjs`

**Interfaces:**
- Consumes: repository layout from the master roadmap.
- Produces: root commands `lint`, `typecheck`, `test`, `test:contracts`, `test:integration`, `test:security`, `test:e2e`, and `build`; workspace package names `@real2/domain`, `@real2/db`, `@real2/integrations`, `@real2/testkit`.

- [ ] **Step 1: Write the failing workspace test**

```js
// tests/repo/workspace.test.mjs
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("pnpm discovers both apps and every shared package", () => {
  const result = spawnSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const names = JSON.parse(result.stdout).map((entry) => entry.name).sort();
  assert.deepEqual(names, [
    "@real2/db", "@real2/domain", "@real2/integrations", "@real2/testkit",
    "@real2/web", "@real2/worker", "real2-sales-dashboard",
  ]);
});
```

- [ ] **Step 2: Run the test and verify the missing root package failure**

Run: `npx --yes -p node@22.23.2 -p pnpm@10.34.5 node --test tests/repo/workspace.test.mjs`

Expected: FAIL because pnpm cannot discover the seven expected workspace projects.

- [ ] **Step 3: Create the workspace manifests and minimal processes**

```json
{
  "name": "real2-sales-dashboard",
  "private": true,
  "packageManager": "pnpm@10.34.5",
  "engines": { "node": "22.x" },
  "scripts": {
    "dev": "pnpm --parallel --filter @real2/web --filter @real2/worker dev",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:contracts": "vitest run --project contracts",
    "test:integration": "vitest run --project integration",
    "test:security": "vitest run --project security",
    "test:e2e": "playwright test",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "@playwright/test": "^1",
    "typescript": "5.9.x",
    "vitest": "^3"
  }
}
```

`.nvmrc` contains exactly `22.23.2`. Each workspace package defines `lint`, `typecheck`, and `build`; test-bearing packages also define `test`. Each shared package exports only its focused `src/index.ts` public surface.

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

The web root renders `РЕАЛ ДВА — дашборд отдела продаж`; the worker `main.ts` exports `runWorkerOnce()` and performs no network call.

- [ ] **Step 4: Install, test, typecheck, and build**

Run: `npx --yes -p node@22.23.2 -p pnpm@10.34.5 sh -c 'pnpm install && node --test tests/repo/workspace.test.mjs && pnpm typecheck && pnpm build'`

Expected: every command exits 0 and `pnpm-lock.yaml` is created.

- [ ] **Step 5: Commit the scaffold**

```bash
git add .nvmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts apps packages tests/repo
git commit -m "build: scaffold REAL2 workspace"
```

### Task 2: Validate server configuration and disabled-by-default switches

**Files:**
- Create: `packages/domain/src/env.ts`
- Create: `packages/domain/src/env.test.ts`
- Create: `packages/domain/src/index.ts`
- Create: `.env.example`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: process environment as `Record<string, string | undefined>`.
- Produces: `parseServerEnv(input): ServerEnv`, `ServerEnv`, and booleans `SYNC_ENABLED`, `SHEET_PUBLISH_ENABLED`.

- [ ] **Step 1: Write failing environment tests**

```ts
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
};

describe("parseServerEnv", () => {
  it("defaults both network switches to false", () => {
    const env = parseServerEnv(base);
    expect(env.SYNC_ENABLED).toBe(false);
    expect(env.SHEET_PUBLISH_ENABLED).toBe(false);
  });

  it("rejects a malformed database URL without exposing its value", () => {
    expect(() => parseServerEnv({ ...base, DATABASE_URL: "secret-value" })).toThrow("DATABASE_URL");
  });
});
```

- [ ] **Step 2: Run the focused test and verify missing implementation**

Run: `pnpm vitest run packages/domain/src/env.test.ts`

Expected: FAIL because `./env` does not exist.

- [ ] **Step 3: Implement the exact Zod contract**

```ts
import { z } from "zod";

const booleanFlag = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const serverEnvSchema = z.object({
  APP_URL: z.url(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?:$/ }),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(8),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(8),
  SYNC_ENABLED: booleanFlag,
  SHEET_PUBLISH_ENABLED: booleanFlag,
}).strict();

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}
```

`.env.example` contains key names and safe local examples only; amoCRM and Google secrets are absent until their plans.

- [ ] **Step 4: Run contract checks**

Run: `pnpm vitest run packages/domain/src/env.test.ts && pnpm typecheck`

Expected: PASS; malformed input error names the field but does not contain `secret-value` in application logs.

- [ ] **Step 5: Commit configuration validation**

```bash
git add .env.example packages/domain apps/web/src/app/page.tsx apps/worker/src/main.ts
git commit -m "feat: validate server configuration"
```

### Task 3: Create identity tables and deny-by-default RLS

**Files:**
- Create: `supabase/migrations/0001_identity_and_controls.sql`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/identity.ts`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/src/identity.integration.test.ts`
- Test: `tests/security/rls.security.test.ts`

**Interfaces:**
- Consumes: Supabase JWT `sub`; service DB URL.
- Produces: `AppRole`, `AppUser`, `findAppUserByAuthId(authUserId)`, `requireActiveAppUser(authUserId)`, and `getSystemControl(key)`.

- [ ] **Step 1: Write the failing RLS test against local Supabase**

```ts
it("manager cannot read another manager row that already exists", async () => {
  await seedUsers(adminDb, [managerOne, managerTwo]);
  const rows = await asJwt(managerOneJwt, (db) => db<AppUser[]>`
    select * from app_users order by email
  `);
  expect(rows.map((row) => row.id)).toEqual([managerOne.id]);
});
```

- [ ] **Step 2: Run the test and verify the missing relation failure**

Run: `pnpm test:integration -- packages/db/src/identity.integration.test.ts`

Expected: FAIL with relation `app_users` missing.

- [ ] **Step 3: Add the migration with explicit controls and RLS**

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
create type app_role as enum ('admin', 'head', 'manager');

create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  email citext not null unique,
  full_name text not null check (length(full_name) between 2 and 120),
  role app_role not null,
  amo_user_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'manager' and amo_user_id is not null) or role <> 'manager')
);

create table system_controls (
  key text primary key check (key in ('sync_enabled', 'sheet_publish_enabled')),
  enabled boolean not null default false,
  reason text not null,
  updated_by uuid references app_users(id),
  updated_at timestamptz not null default now()
);

insert into system_controls (key, enabled, reason) values
  ('sync_enabled', false, 'disabled until staging safety gate'),
  ('sheet_publish_enabled', false, 'disabled until shadow acceptance');

alter table app_users enable row level security;
alter table system_controls enable row level security;

create schema if not exists app;

create function app.current_role() returns app_role language sql stable security definer
set search_path = public as $$
  select role from app_users where auth_user_id = auth.uid() and is_active;
$$;

create policy app_users_self_or_leadership_select on app_users for select
using (auth_user_id = auth.uid() or app.current_role() in ('admin', 'head'));

create policy controls_leadership_select on system_controls for select
using (app.current_role() in ('admin', 'head'));
```

Application roles receive no direct insert/update/delete policy. Administrative mutations use reviewed server functions with the service credential.

- [ ] **Step 4: Implement repository functions and verify positive and negative access**

Run: `supabase db reset && pnpm test:integration -- packages/db/src/identity.integration.test.ts && pnpm test:security -- tests/security/rls.security.test.ts`

Expected: admin/head read all permitted rows; manager reads only self; inactive and anonymous identities read none.

- [ ] **Step 5: Commit identity schema and RLS**

```bash
git add supabase/migrations/0001_identity_and_controls.sql packages/db tests/security/rls.security.test.ts
git commit -m "feat: add identity schema and deny-by-default RLS"
```

### Task 4: Implement private login, logout, and role-scoped user administration

**Files:**
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/auth/require-user.ts`
- Create: `apps/web/src/lib/auth/authorization.ts`
- Create: `apps/web/src/lib/auth/login-rate-limit.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/settings/users/page.tsx`
- Create: `apps/web/src/app/api/auth/login/route.ts`
- Create: `apps/web/src/app/api/auth/logout/route.ts`
- Create: `apps/web/src/app/api/me/route.ts`
- Create: `apps/web/src/app/api/admin/users/route.ts`
- Create: `apps/web/src/app/api/admin/users/[id]/route.ts`
- Create: `scripts/bootstrap-admin.ts`
- Test: `apps/web/src/lib/auth/authorization.test.ts`
- Test: `apps/web/src/lib/auth/login-rate-limit.test.ts`
- Test: `apps/web/src/app/api/admin/users/users.integration.test.ts`

**Interfaces:**
- Consumes: `requireActiveAppUser(authUserId)` from Task 3.
- Produces: `SessionUser = { id; email; fullName; role; amoUserId }`, `requireUser()`, `requireRole(...roles)`, login/logout/me endpoints, and `updatedAt`-checked user administration.

- [ ] **Step 1: Write failing authorization tests**

```ts
describe("requireRole", () => {
  it("does not trust a role supplied by request data", () => {
    const session = { ...managerUser, role: "manager" as const };
    expect(() => requireRole(session, ["admin"], { role: "admin" })).toThrowError("E_FORBIDDEN");
  });

  it("allows an active admin", () => {
    expect(requireRole(adminUser, ["admin"])).toEqual(adminUser);
  });
});
```

- [ ] **Step 2: Run the focused test and verify missing exports**

Run: `pnpm vitest run apps/web/src/lib/auth/authorization.test.ts`

Expected: FAIL because `requireRole` is not defined.

- [ ] **Step 3: Implement server-derived authorization**

```ts
export function requireRole<R extends AppRole>(
  user: SessionUser,
  allowed: readonly R[],
  _untrustedInput?: unknown,
): SessionUser & { role: R } {
  if (!allowed.includes(user.role as R)) throw new AppError("E_FORBIDDEN", 403);
  return user as SessionUser & { role: R };
}

export const loginRatePolicy = {
  key: (email: string, ip: string) => `${email.trim().toLowerCase()}\u0000${ip}`,
  windowMinutes: 15,
  maximumFailures: 5,
  blockMinutes: 15,
} as const;
```

The login handler checks the rate policy, passes email/password to Supabase server-side, then requires an active `app_users` row. All authentication failures return the same Russian message. User creation is admin-only, creates the Supabase identity and application row in compensating steps, and removes the auth identity if the application insert fails. Role/deactivation changes revoke all active sessions. The update transaction rejects deactivation/demotion of the last active admin and compares `expectedUpdatedAt` with the stored timestamp. `scripts/bootstrap-admin.ts` runs server-side once for normalized `BOOTSTRAP_ADMIN_EMAIL` and refuses to run after any admin exists. The users screen implements the four global states and changes its table to cards on mobile.

- [ ] **Step 4: Test inactive, anonymous, manager, head, and admin flows**

Run: `pnpm vitest run apps/web/src/lib/auth/authorization.test.ts apps/web/src/lib/auth/login-rate-limit.test.ts && pnpm test:integration -- apps/web/src/app/api/admin/users/users.integration.test.ts`

Expected: PASS; fifth failed login blocks that email+IP for 15 minutes; manager receives 403 on admin routes; stale `expectedUpdatedAt` receives 409; the final admin cannot demote/deactivate self; role changes revoke prior sessions; no response exposes Supabase internals.

- [ ] **Step 5: Commit authentication and authorization**

```bash
git add apps/web packages/domain packages/db
git commit -m "feat: add private role-scoped access"
```

### Task 5: Standardize API envelopes, errors, trace IDs, and safe logs

**Files:**
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/api-envelope.ts`
- Create: `apps/web/src/lib/http/route.ts`
- Create: `apps/web/src/lib/logging/logger.ts`
- Create: `packages/testkit/src/log-capture.ts`
- Test: `apps/web/src/lib/http/route.test.ts`
- Test: `tests/security/log-redaction.security.test.ts`

**Interfaces:**
- Consumes: any authenticated route handler.
- Produces: `AppError(code, status, safeMessage?)`, `withRoute(handler)`, `success(data, meta)`, `safeLogger`, and ULID `trace_id` propagation.

- [ ] **Step 1: Write failing envelope and redaction tests**

```ts
it("maps unknown failures without SQL or token leakage", async () => {
  const response = await withRoute(async () => {
    throw new Error("token=amo-secret select * from app_users");
  })(new Request("http://local/api/test"));
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body.error.code).toBe("E_INTERNAL");
  expect(JSON.stringify(body)).not.toMatch(/amo-secret|select \*/i);
  expect(body.error.trace_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});
```

- [ ] **Step 2: Run the focused tests and verify missing wrapper failure**

Run: `pnpm vitest run apps/web/src/lib/http/route.test.ts tests/security/log-redaction.security.test.ts`

Expected: FAIL because `withRoute` and `safeLogger` do not exist.

- [ ] **Step 3: Implement allowlisted structured logging**

```ts
const allowedLogKeys = new Set([
  "level", "message", "trace_id", "operation", "method", "normalized_path",
  "status", "duration_ms", "attempt", "result", "sync_run_id", "snapshot_version",
]);

export function sanitizeLog(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowedLogKeys.has(key)));
}
```

`withRoute` creates or validates an incoming trace ID, catches `AppError`, maps unknown errors to `E_INTERNAL`, and always returns the exact envelopes in SPEC 0.4.

- [ ] **Step 4: Run focused and repository tests**

Run: `pnpm vitest run apps/web/src/lib/http/route.test.ts tests/security/log-redaction.security.test.ts && pnpm test && pnpm typecheck`

Expected: PASS; captured logs contain no synthetic token, phone, full name, SQL text, query value, or raw payload.

- [ ] **Step 5: Commit safe API infrastructure**

```bash
git add packages/domain packages/testkit apps/web/src/lib tests/security
git commit -m "feat: add safe API envelopes and trace logging"
```

### Task 6: Add local containers, CI, and live health without external access

**Files:**
- Create: `Dockerfile.web`
- Create: `Dockerfile.worker`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `apps/web/src/app/api/health/live/route.ts`
- Create: `apps/web/src/app/api/health/live/route.test.ts`
- Create: `docs/runbooks/local-development.md`

**Interfaces:**
- Consumes: root quality commands and validated env.
- Produces: containers `web` and `worker`, public process-liveness endpoint, and CI artifact checks.

- [ ] **Step 1: Write the failing liveness route test**

```ts
it("returns process liveness without dependency or secret details", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true, data: { live: true }, meta: expect.any(Object) });
});
```

- [ ] **Step 2: Run the test and verify the route is missing**

Run: `pnpm vitest run apps/web/src/app/api/health/live/route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement liveness, images, Compose, and CI**

```yaml
# docker-compose.yml
services:
  web:
    build: { context: ., dockerfile: Dockerfile.web }
    environment:
      SYNC_ENABLED: "false"
      SHEET_PUBLISH_ENABLED: "false"
    ports: ["3000:3000"]
  worker:
    build: { context: ., dockerfile: Dockerfile.worker }
    environment:
      SYNC_ENABLED: "false"
      SHEET_PUBLISH_ENABLED: "false"
```

CI uses Node 22, Corepack, `pnpm install --frozen-lockfile`, lint, typecheck, test, security test, and build. It rejects tracked `.env`, PEM, OAuth JSON, or service-account JSON files.

- [ ] **Step 4: Verify clean containers and CI-equivalent checks**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:security && pnpm build && docker compose config`

Expected: all commands exit 0; resolved Compose keeps both switches false and contains no production secret.

- [ ] **Step 5: Commit the foundation delivery**

```bash
git add Dockerfile.web Dockerfile.worker docker-compose.yml .github apps/web/src/app/api/health docs/runbooks/local-development.md
git commit -m "ci: verify isolated web and worker foundation"
```

## Plan 1 completion gate

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm build
git status --short
```

Expected: all checks pass; git status is clean; no external credential has been added; both network switches remain false. Continue only after an independent review of RLS, logs, and tracked files.
