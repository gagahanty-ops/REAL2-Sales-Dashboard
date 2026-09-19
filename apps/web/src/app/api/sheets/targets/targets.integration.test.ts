import { getSheetTarget, listSheetLayoutMappings, type SheetTarget } from "@real2/db";
import type { SheetClient, SheetMetadata } from "@real2/integrations";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../../tests/helpers/local-db";
import { replaceMappings, validateSheetTarget } from "../../../../lib/sheets/target-service";

import { GET, POST } from "./route";
import { POST as ACTIVATE } from "./[id]/activate/route";

const adminDb = createAdminDb();
const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null as number | null,
  },
}));

vi.mock("../../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));
vi.mock("../../../../lib/server/runtime", () => ({
  getDatabase: () => adminDb,
  getServerEnv: () => ({ APP_URL: "https://dashboard.example.test" }),
}));

const ORIGIN = "https://dashboard.example.test";
const COPY_ID = "1CopySpreadsheetIdentifierForTests_0001";
const ORIGINAL_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";
const CHANNELS_SHEET = "каналы сентябрь 2026";
const PLAN_SHEET = "выполнение плана сентябрь 2026";

function metadata(overrides: Partial<SheetMetadata> = {}): SheetMetadata {
  return {
    title: "Копия отчёта РЕАЛ ДВА",
    sheets: [
      { title: CHANNELS_SHEET, rowCount: 100, columnCount: 12 },
      { title: PLAN_SHEET, rowCount: 50, columnCount: 8 },
    ],
    ...overrides,
  };
}

function deps(meta: SheetMetadata = metadata()) {
  const client: SheetClient = {
    readMetadata: async () => meta,
    readValues: async () => [],
    writeValues: async () => {
      throw new Error("validation must never write");
    },
  };
  return {
    db: adminDb,
    secrets: {
      readGoogleServiceAccount: async () => ({
        clientEmail: "publisher@example.iam.gserviceaccount.com",
        privateKey: "synthetic",
      }),
    },
    factory: async () => client,
  };
}

const CHANNEL_FIELDS = [
  "report_date",
  "channel",
  "leads_created",
  "applications",
  "payments",
  "revenue",
] as const;
const PLAN_FIELDS = ["metric", "plan_target", "actual_value", "completion_pct"] as const;

function completeMappings() {
  const columns = ["A", "B", "C", "D", "E", "F"];
  return [
    ...CHANNEL_FIELDS.map((logicalField, index) => ({
      reportKind: "channels_daily" as const,
      logicalField,
      sheetName: CHANNELS_SHEET,
      rangeA1: `${columns[index]}2:${columns[index]}31`,
      valueType: logicalField === "revenue" ? ("money" as const) : ("text" as const),
    })),
    ...PLAN_FIELDS.map((logicalField, index) => ({
      reportKind: "plan_fact" as const,
      logicalField,
      sheetName: PLAN_SHEET,
      rangeA1: `${columns[index]}2:${columns[index]}10`,
      valueType: "text" as const,
    })),
  ];
}

function jsonRequest(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/sheets/targets`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function payload(response: Response): Promise<{
  ok: boolean;
  data?: Record<string, never>;
  error?: { code: string };
}> {
  return (await response.json()) as never;
}

async function createTarget(): Promise<SheetTarget> {
  const response = await POST(
    jsonRequest({ spreadsheetId: COPY_ID, expectedTitle: "Копия отчёта РЕАЛ ДВА" }),
  );
  const body = await payload(response);
  return body.data as never as SheetTarget;
}

beforeEach(async () => {
  await adminDb.unsafe(
    "truncate table public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets",
  );
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
  session.user.id = testUsers.admin.id;
  session.user.role = "admin";
});
afterAll(async () => {
  await adminDb.unsafe(
    "truncate table public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets",
  );
  await adminDb.end();
});

describe("sheet target configuration", () => {
  it("registers a copy, validates it against the real layout and activates it", async () => {
    const target = await createTarget();
    expect(target.status).toBe("draft");

    await replaceMappings(deps(), target.id, completeMappings());
    const report = await validateSheetTarget(deps(), target.id);
    expect(report.target.status).toBe("validated");
    expect(report.layoutFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.sheets).toEqual([CHANNELS_SHEET, PLAN_SHEET]);

    const activated = await ACTIVATE(jsonRequest({}), {
      params: Promise.resolve({ id: target.id }),
    });
    expect(activated.status).toBe(200);
    await expect(getSheetTarget(adminDb, target.id)).resolves.toMatchObject({
      status: "active",
    });
  });

  it("refuses the protected original spreadsheet", async () => {
    const response = await POST(
      jsonRequest({ spreadsheetId: ORIGINAL_ID, expectedTitle: "Оригинал" }),
    );
    const body = await payload(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("E_SHEET_PROTECTED");
  });

  it("refuses validation when the copy's title or structure drifted", async () => {
    const target = await createTarget();
    await replaceMappings(deps(), target.id, completeMappings());

    await expect(
      validateSheetTarget(deps(metadata({ title: "Совсем другая копия" })), target.id),
    ).rejects.toMatchObject({ code: "E_SHEET_LAYOUT_MISMATCH" });

    await expect(
      validateSheetTarget(
        deps(metadata({ sheets: [{ title: CHANNELS_SHEET, rowCount: 5, columnCount: 3 }] })),
        target.id,
      ),
    ).rejects.toMatchObject({ code: "E_SHEET_LAYOUT_MISMATCH" });

    await expect(getSheetTarget(adminDb, target.id)).resolves.toMatchObject({
      status: "draft",
    });
  });

  it("refuses to validate a target without mappings", async () => {
    const target = await createTarget();

    await expect(validateSheetTarget(deps(), target.id)).rejects.toMatchObject({
      code: "E_CONFIG_INCOMPLETE",
    });
  });

  it("refuses to activate a target that was never validated", async () => {
    const target = await createTarget();

    const response = await ACTIVATE(jsonRequest({}), {
      params: Promise.resolve({ id: target.id }),
    });

    expect(response.status).toBe(409);
  });

  it("refuses to change the mapping of an active target", async () => {
    const target = await createTarget();
    await replaceMappings(deps(), target.id, completeMappings());
    await validateSheetTarget(deps(), target.id);
    await ACTIVATE(jsonRequest({}), { params: Promise.resolve({ id: target.id }) });

    await expect(replaceMappings(deps(), target.id, completeMappings())).rejects
      .toMatchObject({ code: "E_CONFLICT" });
    await expect(listSheetLayoutMappings(adminDb, target.id)).resolves.toHaveLength(10);
  });

  it("refuses an overlapping mapping before anything is stored", async () => {
    const target = await createTarget();
    const overlapping = completeMappings();
    overlapping[1] = { ...(overlapping[1] as never), rangeA1: "A2:B31" };

    await replaceMappings(deps(), target.id, overlapping);
    await expect(validateSheetTarget(deps(), target.id)).rejects.toMatchObject({
      code: "E_SHEET_LAYOUT_MISMATCH",
    });
  });

  it("lets a head read the configuration but not change it", async () => {
    await createTarget();
    session.user.role = "head";
    session.user.id = testUsers.head.id;

    const listed = await GET(new Request(`${ORIGIN}/api/sheets/targets`));
    expect(listed.status).toBe(200);

    const created = await POST(
      jsonRequest({ spreadsheetId: "1AnotherCopySpreadsheetIdentifier02", expectedTitle: "Копия" }),
    );
    expect(created.status).toBe(403);
  });

  it("refuses a manager and a cross-origin write", async () => {
    session.user.role = "manager";
    session.user.id = testUsers.managerOne.id;
    expect((await GET(new Request(`${ORIGIN}/api/sheets/targets`))).status).toBe(403);

    session.user.role = "admin";
    session.user.id = testUsers.admin.id;
    const crossOrigin = await POST(
      jsonRequest(
        { spreadsheetId: "1YetAnotherCopySpreadsheetIdent03", expectedTitle: "Копия" },
        "https://evil.example.test",
      ),
    );
    expect(crossOrigin.status).toBe(403);
  });
});
