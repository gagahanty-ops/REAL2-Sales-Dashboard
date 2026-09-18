import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../tests/helpers/local-db";

import { GET, POST } from "./route";
import { GET as GET_SNAPSHOT } from "../snapshots/[version]/route";

const adminDb = createAdminDb();
const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null,
  },
}));

vi.mock("../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({ APP_URL: "https://dashboard.example.test" }),
}));

const ORIGIN = "https://dashboard.example.test";

function planRequest(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/plans`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listRequest(query = ""): Request {
  return new Request(`${ORIGIN}/api/plans${query}`, { headers: { origin: ORIGIN } });
}

async function payload(response: Response): Promise<{
  ok: boolean;
  data?: unknown;
}> {
  return (await response.json()) as never;
}

async function clearFixtures(): Promise<void> {
  // Plan rows are immutable, so fixtures are truncated rather than deleted.
  await adminDb.unsafe("truncate table public.sales_plans");
}

beforeEach(async () => {
  await clearFixtures();
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
  session.user.id = testUsers.admin.id;
  session.user.role = "admin";
});
afterEach(clearFixtures);
afterAll(async () => {
  await adminDb.end();
});

describe("sales plan API", () => {
  const validPlan = {
    month: "2026-09-01",
    managerKey: "all",
    metricKey: "revenue",
    targetValue: "1000000.00",
  };

  it("stores a target and lists it back", async () => {
    expect((await POST(planRequest(validPlan))).status).toBe(200);

    const listed = await payload(await GET(listRequest("?month=2026-09-01")));
    expect(listed.ok).toBe(true);
    expect(listed.data).toHaveLength(1);
  });

  it("versions a changed target instead of overwriting it", async () => {
    await POST(planRequest(validPlan));
    await POST(planRequest({ ...validPlan, targetValue: "1200000.00" }));

    const listed = await payload(await GET(listRequest("?month=2026-09-01")));
    expect(listed.data).toHaveLength(2);
  });

  it("refuses a head and a manager from writing a plan", async () => {
    session.user.role = "head";
    session.user.id = testUsers.head.id;
    expect((await POST(planRequest(validPlan))).status).toBe(403);
    expect((await GET(listRequest())).status).toBe(200);

    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    expect((await GET(listRequest())).status).toBe(403);
  });

  it("refuses a cross-origin write, a mid-month date and a malformed target", async () => {
    expect((await POST(planRequest(validPlan, "https://evil.example.test"))).status)
      .toBe(403);
    expect((await POST(planRequest({ ...validPlan, month: "2026-09-15" }))).status)
      .toBe(422);
    expect((await POST(planRequest({ ...validPlan, targetValue: "1000" }))).status)
      .toBe(422);
    expect((await POST(planRequest({ ...validPlan, metricKey: "made_up" }))).status)
      .toBe(422);
  });

  it("reports a missing snapshot instead of inventing one", async () => {
    const response = await GET_SNAPSHOT(
      new Request(`${ORIGIN}/api/snapshots/current`, { headers: { origin: ORIGIN } }),
      { params: Promise.resolve({ version: "current" }) },
    );

    expect(response.status).toBe(404);
  });

  it("refuses a manager reading a snapshot and rejects a malformed version", async () => {
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    const forbidden = await GET_SNAPSHOT(
      new Request(`${ORIGIN}/api/snapshots/1`, { headers: { origin: ORIGIN } }),
      { params: Promise.resolve({ version: "1" }) },
    );
    expect(forbidden.status).toBe(403);

    session.user.role = "admin";
    session.user.id = testUsers.admin.id;
    const malformed = await GET_SNAPSHOT(
      new Request(`${ORIGIN}/api/snapshots/0`, { headers: { origin: ORIGIN } }),
      { params: Promise.resolve({ version: "0" }) },
    );
    expect(malformed.status).toBe(422);
  });
});
