import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  acknowledgeAlert,
  countOpenAlerts,
  listAlerts,
  raiseAlert,
  resolveAlert,
} from "./alerts";
import { closeDbClient, createDbClient, type Database } from "./client";
import {
  createAdminDb,
  localDatabaseUrl,
  resetAndSeedUsers,
  testUsers,
} from "../../../tests/helpers/local-db";

const adminDb = createAdminDb();
let db: Database;

const BASE = {
  traceId: "01M2V6QAKXVY2D248F5NYA6FR6",
  source: "sheet_publication",
  code: "E_SHEET_UPSTREAM",
  severity: "critical" as const,
  safeSummary: "Google ответил ошибкой при публикации",
};

beforeAll(() => {
  db = createDbClient(localDatabaseUrl, { max: 2 });
});
beforeEach(async () => {
  await adminDb.unsafe("truncate table public.system_alerts");
  await resetAndSeedUsers(adminDb, [testUsers.admin]);
});
afterAll(async () => {
  await adminDb.unsafe("truncate table public.system_alerts");
  await Promise.all([closeDbClient(db), closeDbClient(adminDb)]);
});

describe("system alerts", () => {
  it("keeps one open alert per source and code and counts repeats", async () => {
    const first = await raiseAlert(db, BASE);
    const second = await raiseAlert(db, { ...BASE, traceId: "other-trace" });

    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
    await expect(countOpenAlerts(db)).resolves.toBe(1);
  });

  it("separates alerts of different codes and sources", async () => {
    await raiseAlert(db, BASE);
    await raiseAlert(db, { ...BASE, code: "E_SHEET_LAYOUT_MISMATCH" });
    await raiseAlert(db, { ...BASE, source: "amo_sync" });

    await expect(countOpenAlerts(db)).resolves.toBe(3);
    await expect(countOpenAlerts(db, "critical")).resolves.toBe(3);
    await expect(countOpenAlerts(db, "warning")).resolves.toBe(0);
  });

  it("acknowledges and then resolves an alert, keeping the history", async () => {
    const alert = await raiseAlert(db, BASE);

    const acknowledged = await acknowledgeAlert(db, alert.id, testUsers.admin.id);
    expect(acknowledged.status).toBe("acknowledged");
    await expect(acknowledgeAlert(db, alert.id, testUsers.admin.id)).rejects
      .toMatchObject({ code: "E_CONFLICT" });

    const resolved = await resolveAlert(db, BASE.source, BASE.code);
    expect(resolved?.status).toBe("resolved");
    await expect(countOpenAlerts(db)).resolves.toBe(0);
    await expect(listAlerts(db)).resolves.toHaveLength(1);
  });

  it("opens a new alert after the previous one was resolved", async () => {
    const first = await raiseAlert(db, BASE);
    await resolveAlert(db, BASE.source, BASE.code);
    const second = await raiseAlert(db, BASE);

    expect(second.id).not.toBe(first.id);
    expect(second.occurrenceCount).toBe(1);
    await expect(listAlerts(db)).resolves.toHaveLength(2);
  });

  it("refuses an empty summary and an impossible page size", async () => {
    await expect(raiseAlert(db, { ...BASE, safeSummary: "   " })).rejects
      .toMatchObject({ code: "E_VALIDATION" });
    await expect(listAlerts(db, { limit: 0 })).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("filters by status", async () => {
    await raiseAlert(db, BASE);
    await raiseAlert(db, { ...BASE, code: "E_SHEET_LAYOUT_MISMATCH" });
    const [alert] = await listAlerts(db);
    if (!alert) throw new Error("missing alert fixture");
    await acknowledgeAlert(db, alert.id, testUsers.admin.id);

    await expect(listAlerts(db, { status: "open" })).resolves.toHaveLength(1);
    await expect(listAlerts(db, { status: "acknowledged" })).resolves.toHaveLength(1);
  });
});
