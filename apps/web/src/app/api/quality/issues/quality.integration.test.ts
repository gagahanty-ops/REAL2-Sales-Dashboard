import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../../tests/helpers/local-db";

import { acceptQualityIssue } from "@real2/db";

import { GET } from "./route";
import { POST as ACCEPT } from "./[id]/accept/route";

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

vi.mock("../../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({ APP_URL: "https://dashboard.example.test" }),
}));

const ACCOUNT_ID = 9001;
const ORIGIN = "https://dashboard.example.test";

type IssueSeed = Readonly<{
  amoLeadId: number;
  code: string;
  severity: "info" | "warning" | "blocking";
  lastSeenAt: string;
}>;

async function seedIssues(seeds: readonly IssueSeed[]): Promise<readonly string[]> {
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
  session.user.id = testUsers.admin.id;
  session.user.role = "admin";
  const ids: string[] = [];
  for (const seed of seeds) {
    const [row] = await adminDb<{ id: string }[]>`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity, status, safe_details,
        first_seen_at, last_seen_at
      ) values (
        ${ACCOUNT_ID}, ${seed.amoLeadId}, ${seed.code}, ${seed.severity}, 'open',
        ${adminDb.json({ count: 1 })}, ${seed.lastSeenAt}, ${seed.lastSeenAt}
      ) returning id
    `;
    if (!row) throw new Error("quality issue fixture is missing");
    ids.push(row.id);
  }
  return ids;
}

function listRequest(query = ""): Request {
  return new Request(`${ORIGIN}/api/quality/issues${query}`, {
    headers: { origin: ORIGIN },
  });
}

function acceptRequest(reason: unknown): Request {
  return new Request(`${ORIGIN}/api/quality/issues/x/accept`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function body(response: Response): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}> {
  return (await response.json()) as never;
}

async function clearFixtures(): Promise<void> {
  await adminDb`delete from public.data_quality_issues`;
}

beforeEach(clearFixtures);
afterEach(clearFixtures);
afterAll(async () => {
  await adminDb.end();
});

describe("quality issue API", () => {
  it("lists open issues with the publication gate for leadership", async () => {
    await seedIssues([
      {
        amoLeadId: 11,
        code: "unknown_channel",
        severity: "warning",
        lastSeenAt: "2026-09-18T09:00:00Z",
      },
      {
        amoLeadId: 12,
        code: "missing_stage_history",
        severity: "blocking",
        lastSeenAt: "2026-09-18T10:00:00Z",
      },
    ]);

    const payload = await body(await GET(listRequest()));

    expect(payload.ok).toBe(true);
    expect(payload.data?.items).toHaveLength(2);
    expect(payload.data?.summary).toMatchObject({
      unknown_channel_count: 1,
      missing_stage_history_count: 1,
    });
    expect(payload.data?.gate).toEqual({
      approved: false,
      blockingCodes: ["missing_stage_history_count"],
    });
  });

  it("returns issues newest first and pages through a stable cursor", async () => {
    await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
      { amoLeadId: 12, code: "missing_responsible", severity: "warning", lastSeenAt: "2026-09-18T10:00:00Z" },
      { amoLeadId: 13, code: "invalid_price", severity: "warning", lastSeenAt: "2026-09-18T11:00:00Z" },
    ]);

    const first = await body(await GET(listRequest("?pageSize=2")));
    const firstItems = first.data?.items as { amoLeadId: number }[];
    expect(firstItems.map((issue) => issue.amoLeadId)).toEqual([13, 12]);
    const cursor = first.data?.nextCursor as string;
    expect(cursor).toBeTruthy();

    const second = await body(
      await GET(listRequest(`?pageSize=2&cursor=${encodeURIComponent(cursor)}`)),
    );
    const secondItems = second.data?.items as { amoLeadId: number }[];
    expect(secondItems.map((issue) => issue.amoLeadId)).toEqual([11]);
    expect(second.data?.nextCursor).toBeNull();
  });

  it("filters by code and refuses an unknown code", async () => {
    await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
      { amoLeadId: 12, code: "invalid_price", severity: "warning", lastSeenAt: "2026-09-18T10:00:00Z" },
    ]);

    const filtered = await body(await GET(listRequest("?code=invalid_price")));
    expect(filtered.data?.items).toHaveLength(1);

    const invalid = await GET(listRequest("?code=made_up_code"));
    expect(invalid.status).toBe(422);
  });

  it("refuses a manager and lets a head read but not accept", async () => {
    const [issueId] = await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    expect((await GET(listRequest())).status).toBe(403);

    session.user.role = "head";
    session.user.id = testUsers.head.id;
    expect((await GET(listRequest())).status).toBe(200);
    expect(
      (await ACCEPT(acceptRequest("Источник подтверждён вручную"), routeContext(issueId)))
        .status,
    ).toBe(403);
  });

  it("accepts an acceptable issue and keeps the reason as evidence", async () => {
    const [issueId] = await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    const response = await ACCEPT(
      acceptRequest("Канал подтверждён вручную руководителем"),
      routeContext(issueId),
    );

    expect(response.status).toBe(200);
    const [row] = await adminDb<{
      status: string;
      resolved_at: Date | null;
      safe_details: Record<string, unknown>;
    }[]>`
      select status, resolved_at, safe_details from public.data_quality_issues
      where id = ${issueId}
    `;
    expect(row?.status).toBe("accepted");
    expect(row?.resolved_at).not.toBeNull();
    expect(row?.safe_details).toMatchObject({
      count: 1,
      acceptanceReason: "Канал подтверждён вручную руководителем",
      acceptedBy: testUsers.admin.id,
    });
  });

  it("refuses to accept a code the specification forbids", async () => {
    const [issueId] = await seedIssues([
      {
        amoLeadId: 12,
        code: "missing_stage_history",
        severity: "blocking",
        lastSeenAt: "2026-09-18T10:00:00Z",
      },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    const response = await ACCEPT(
      acceptRequest("Историю восстановим вручную позже"),
      routeContext(issueId),
    );

    expect(response.status).toBe(409);
    const [row] = await adminDb<{ status: string }[]>`
      select status from public.data_quality_issues where id = ${issueId}
    `;
    expect(row?.status).toBe("open");
  });

  it("refuses a blank or too short reason and a second acceptance", async () => {
    const [issueId] = await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    expect((await ACCEPT(acceptRequest("   "), routeContext(issueId))).status).toBe(422);
    expect((await ACCEPT(acceptRequest("коротко"), routeContext(issueId))).status).toBe(422);
    expect(
      (await ACCEPT(acceptRequest("Канал подтверждён вручную"), routeContext(issueId)))
        .status,
    ).toBe(200);
    expect(
      (await ACCEPT(acceptRequest("Канал подтверждён вручную"), routeContext(issueId)))
        .status,
    ).toBe(409);
  });

  it("guards the acceptance reason in the repository itself, not only in the route", async () => {
    const [issueId] = await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    await expect(
      acceptQualityIssue(adminDb, {
        issueId,
        actorId: testUsers.admin.id,
        reason: "коротко",
      }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    await expect(
      acceptQualityIssue(adminDb, {
        issueId,
        actorId: testUsers.admin.id,
        reason: "ы".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    const [row] = await adminDb<{ status: string }[]>`
      select status from public.data_quality_issues where id = ${issueId}
    `;
    expect(row?.status).toBe("open");
  });

  it("refuses a cross-origin acceptance", async () => {
    const [issueId] = await seedIssues([
      { amoLeadId: 11, code: "unknown_channel", severity: "warning", lastSeenAt: "2026-09-18T09:00:00Z" },
    ]);
    if (!issueId) throw new Error("missing issue fixture");

    const request = new Request(`${ORIGIN}/api/quality/issues/x/accept`, {
      method: "POST",
      headers: { origin: "https://evil.example.test", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Канал подтверждён вручную" }),
    });

    expect((await ACCEPT(request, routeContext(issueId))).status).toBe(403);
  });

  it("reports an unknown issue as not found", async () => {
    await seedIssues([]);

    const response = await ACCEPT(
      acceptRequest("Канал подтверждён вручную"),
      routeContext("00000000-0000-4000-8000-000000000000"),
    );

    expect(response.status).toBe(404);
  });
});
