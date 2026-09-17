### Task 3: Implement admin OAuth routes without exposing credentials

**Files:**
- Create: `apps/web/src/app/api/integrations/amo/status/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/start/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/callback/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/refresh/route.ts`
- Create: `apps/web/src/app/api/integrations/amo/disconnect/route.ts`
- Create: `apps/web/src/app/settings/integrations/amo/page.tsx`
- Create: `apps/web/src/app/api/integrations/amo/oauth.integration.test.ts`

**Interfaces:**
- Consumes: OAuth functions from Task 2 and `requireRole(user, ['admin'])`.
- Produces: M2.3 endpoints and a status page showing account ID, subdomain, connection status, and token expiry only.

- [ ] **Step 1: Write a failing callback test for account binding**

```ts
it("rejects an OAuth result bound to a different account", async () => {
  amoMock.queueTokenPair(tokenPair);
  amoMock.queueAccount({ id: 999, subdomain: "another-account" });
  const response = await callbackRoute(adminRequest(validState, "auth-code"));
  expect(response.status).toBe(409);
  expect(await connectionRepository.count()).toBe(0);
});
```

- [ ] **Step 2: Run the integration test and verify routes are missing**

Run: `pnpm test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts`

Expected: FAIL on missing callback route.

- [ ] **Step 3: Implement exact routes and safe status UI**

The callback performs, in order: active admin check, state consumption, code exchange, GET `/api/v4/account`, exact host/subdomain verification, encrypted save, and safe redirect. Disconnect changes only the local connection status and performs no amoCRM business request.

```ts
export const POST = withRoute(async (request) => {
  const admin = requireRole(await requireUser(), ["admin"]);
  const { connectionId } = refreshRequestSchema.parse(await request.json());
  await refreshConnection(connectionId, admin.id);
  return success({ refreshed: true });
});
```

- [ ] **Step 4: Verify auth, replay, wrong account, refresh, and disconnect**

Run: `pnpm test:integration -- apps/web/src/app/api/integrations/amo/oauth.integration.test.ts && pnpm test:security`

Expected: PASS; non-admin receives 403; credentials never appear in body, HTML, redirect, or captured logs.

- [ ] **Step 5: Commit the OAuth administration flow**

```bash
git add apps/web/src/app/api/integrations apps/web/src/app/settings/integrations
git commit -m "feat: add external amoCRM OAuth administration"
```

