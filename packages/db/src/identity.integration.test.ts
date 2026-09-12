import { afterAll, describe, expect, it } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
  visibleAppUserIds,
} from "../../../tests/helpers/local-db";
import {
  findAppUserByAuthId,
  getSystemControl,
  requireActiveAppUser,
} from "./identity";

const adminDb = createAdminDb();

afterAll(async () => {
  await adminDb.end();
});

describe("app_users RLS", () => {
  it("prevents a manager from reading another existing manager", async () => {
    await resetAndSeedUsers(adminDb, [
      testUsers.managerOne,
      testUsers.managerTwo,
    ]);

    await expect(
      visibleAppUserIds(
        adminDb,
        "authenticated",
        testUsers.managerOne.authUserId,
      ),
    ).resolves.toEqual([testUsers.managerOne.id]);
  });
});

describe("identity repository", () => {
  it("loads an application user by the server-derived auth id", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.managerOne]);

    await expect(
      findAppUserByAuthId(adminDb, testUsers.managerOne.authUserId),
    ).resolves.toMatchObject({
      id: testUsers.managerOne.id,
      authUserId: testUsers.managerOne.authUserId,
      email: testUsers.managerOne.email,
      fullName: testUsers.managerOne.fullName,
      role: "manager",
      amoUserId: testUsers.managerOne.amoUserId,
      isActive: true,
    });
  });

  it("returns null when the auth identity is not allowlisted", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.managerOne]);

    await expect(
      findAppUserByAuthId(
        adminDb,
        "20000000-0000-4000-8000-000000000099",
      ),
    ).resolves.toBeNull();
  });

  it("rejects an inactive application user", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.inactiveManager]);

    await expect(
      requireActiveAppUser(adminDb, testUsers.inactiveManager.authUserId),
    ).rejects.toMatchObject({ code: "E_FORBIDDEN" });
  });

  it("reads a disabled system control", async () => {
    await expect(getSystemControl(adminDb, "sync_enabled")).resolves.toMatchObject(
      {
        key: "sync_enabled",
        enabled: false,
      },
    );
  });
});
