import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
  updateOwnNameAsManager,
  visibleAppUserIds,
  visibleControlKeys,
} from "../helpers/local-db";

const adminDb = createAdminDb();
const allUsers = Object.values(testUsers);

beforeEach(async () => {
  await resetAndSeedUsers(adminDb, allUsers);
});

afterAll(async () => {
  await adminDb.end();
});

describe("identity RLS deny-by-default rules", () => {
  it.each([testUsers.admin, testUsers.head])(
    "$role can read every application user",
    async (user) => {
      await expect(
        visibleAppUserIds(adminDb, "authenticated", user.authUserId),
      ).resolves.toHaveLength(allUsers.length);
    },
  );

  it("allows an active manager to read only their own row", async () => {
    await expect(
      visibleAppUserIds(
        adminDb,
        "authenticated",
        testUsers.managerOne.authUserId,
      ),
    ).resolves.toEqual([testUsers.managerOne.id]);
  });

  it("returns no rows for an inactive identity", async () => {
    await expect(
      visibleAppUserIds(
        adminDb,
        "authenticated",
        testUsers.inactiveManager.authUserId,
      ),
    ).resolves.toEqual([]);
  });

  it("does not grant anonymous access to application users", async () => {
    await expect(visibleAppUserIds(adminDb, "anon")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("lets leadership read controls but hides them from managers", async () => {
    await expect(
      visibleControlKeys(adminDb, testUsers.admin.authUserId),
    ).resolves.toEqual(["sheet_publish_enabled", "sync_enabled"]);
    await expect(
      visibleControlKeys(adminDb, testUsers.head.authUserId),
    ).resolves.toEqual(["sheet_publish_enabled", "sync_enabled"]);
    await expect(
      visibleControlKeys(adminDb, testUsers.managerOne.authUserId),
    ).resolves.toEqual([]);
  });

  it("does not allow a manager to update even their own row", async () => {
    await expect(
      updateOwnNameAsManager(adminDb, testUsers.managerOne),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
