### Task 1: Enforce the amoCRM host, method, and path allowlist

**Files:**
- Create: `packages/integrations/src/amo/policy.ts`
- Create: `packages/integrations/src/amo/transport.ts`
- Create: `packages/integrations/src/amo/types.ts`
- Create: `packages/integrations/src/amo/policy.test.ts`
- Create: `packages/integrations/src/amo/transport.integration.test.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes: `AmoTokenProvider.getAccessToken()` and an injected `fetchFn`.
- Produces: `assertAmoRequestAllowed(input): NormalizedAmoRequest`, `amoFetch<T>(request): Promise<T>`, `AmoAuditSink.record(entry)`, and errors `E_AMO_METHOD_DENIED`, `E_AMO_PATH_DENIED`.

- [ ] **Step 1: Write failing policy tests for allowed and forbidden requests**

```ts
it.each([
  ["GET", "/api/v4/account"],
  ["GET", "/api/v4/leads"],
  ["GET", "/api/v4/leads/123"],
  ["GET", "/api/v4/leads/pipelines"],
  ["GET", "/api/v4/leads/pipelines/77/statuses"],
  ["GET", "/api/v4/leads/custom_fields"],
  ["GET", "/api/v4/users"],
  ["GET", "/api/v4/events"],
  ["POST", "/oauth2/access_token"],
])("allows %s %s", (method, path) => {
  expect(assertAmoRequestAllowed({ method, url: `https://555151.amocrm.ru${path}` })).toMatchObject({ method, normalizedPath: path });
});

it.each(["POST", "PATCH", "PUT", "DELETE"])("denies %s on business paths", (method) => {
  expect(() => assertAmoRequestAllowed({ method, url: "https://555151.amocrm.ru/api/v4/leads/123" }))
    .toThrowError("E_AMO_METHOD_DENIED");
});

it("denies an attacker-controlled host", () => {
  expect(() => assertAmoRequestAllowed({ method: "GET", url: "https://example.org/api/v4/leads" }))
    .toThrowError("E_AMO_PATH_DENIED");
});
```

- [ ] **Step 2: Run the policy test and verify the missing module failure**

Run: `pnpm vitest run packages/integrations/src/amo/policy.test.ts`

Expected: FAIL because `assertAmoRequestAllowed` does not exist.

- [ ] **Step 3: Implement a closed allowlist and guarded transport**

```ts
const AMO_HOST = "555151.amocrm.ru";
const businessGetPaths = [
  /^\/api\/v4\/account$/,
  /^\/api\/v4\/users$/,
  /^\/api\/v4\/leads(?:\/\d+)?$/,
  /^\/api\/v4\/leads\/custom_fields$/,
  /^\/api\/v4\/leads\/pipelines(?:\/\d+(?:\/statuses)?)?$/,
  /^\/api\/v4\/events$/,
];

export function assertAmoRequestAllowed(input: { method: string; url: string }): NormalizedAmoRequest {
  const url = new URL(input.url);
  const method = input.method.toUpperCase();
  if (url.protocol !== "https:" || url.hostname !== AMO_HOST || url.port) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }
  if (method === "POST" && url.pathname === "/oauth2/access_token") {
    return { method, url, normalizedPath: url.pathname, kind: "oauth" };
  }
  if (method !== "GET") throw new AppError("E_AMO_METHOD_DENIED", 403);
  if (!businessGetPaths.some((pattern) => pattern.test(url.pathname))) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }
  return { method, url, normalizedPath: url.pathname, kind: "business" };
}
```

`amoFetch` calls this function before resolving a token or invoking `fetchFn`, sets `redirect: "error"`, validates JSON through a caller-supplied Zod schema, and writes only the safe audit fields.

- [ ] **Step 4: Prove forbidden calls never reach the mock server**

Run: `pnpm vitest run packages/integrations/src/amo/policy.test.ts packages/integrations/src/amo/transport.integration.test.ts`

Expected: PASS; mock ledger length remains 0 for forbidden method, path, host, protocol, and redirect cases.

- [ ] **Step 5: Commit the guarded transport**

```bash
git add packages/integrations
git commit -m "feat: enforce amoCRM read-only transport"
```

