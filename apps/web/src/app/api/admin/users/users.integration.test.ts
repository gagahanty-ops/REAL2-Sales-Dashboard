import { afterAll, describe, expect, it } from "vitest";

import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../../tests/helpers/local-db";
import { findAppUserByAuthId } from "@real2/db";
import {
  createManagedUser,
  updateManagedUser,
  type ManagedAuthAdmin,
} from "../../../../lib/auth/user-admin";

const adminDb = createAdminDb();

class FakeAuthAdmin implements ManagedAuthAdmin {
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly revoked: string[] = [];
  nextAuthUserId = "20000000-0000-4000-8000-000000000090";

  async createUser(): Promise<{ id: string }> {
    this.created.push(this.nextAuthUserId);
    return { id: this.nextAuthUserId };
  }

  async deleteUser(authUserId: string): Promise<void> {
    this.deleted.push(authUserId);
  }

  async revokeSessions(authUserId: string): Promise<void> {
    this.revoked.push(authUserId);
  }
}

afterAll(async () => {
  await adminDb.end();
});

describe("admin user management", () => {
  it("removes a newly created auth identity when the app row insert fails", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.admin]);
    const auth = new FakeAuthAdmin();

    await expect(
      createManagedUser(adminDb, auth, {
        email: testUsers.admin.email,
        password: "Local-password-123!",
        fullName: "Duplicate Email",
        role: "head",
        amoUserId: null,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    expect(auth.deleted).toEqual([auth.nextAuthUserId]);
  });

  it("rejects a stale optimistic timestamp with E_CONFLICT", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.managerOne]);
    const auth = new FakeAuthAdmin();
    const manager = await findAppUserByAuthId(
      adminDb,
      testUsers.managerOne.authUserId,
    );

    await updateManagedUser(adminDb, auth, testUsers.managerOne.id, {
      fullName: "Manager Updated",
      role: "manager",
      amoUserId: 101,
      isActive: true,
      expectedUpdatedAt: manager!.updatedAt.toISOString(),
    });

    await expect(
      updateManagedUser(adminDb, auth, testUsers.managerOne.id, {
        fullName: "Stale Update",
        role: "manager",
        amoUserId: 101,
        isActive: true,
        expectedUpdatedAt: manager!.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("does not deactivate the final active admin", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.admin]);
    const auth = new FakeAuthAdmin();
    const admin = await findAppUserByAuthId(adminDb, testUsers.admin.authUserId);

    await expect(
      updateManagedUser(adminDb, auth, testUsers.admin.id, {
        fullName: testUsers.admin.fullName,
        role: "admin",
        amoUserId: null,
        isActive: false,
        expectedUpdatedAt: admin!.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "E_LAST_ADMIN" });
  });

  it("revokes sessions after a role change", async () => {
    await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.managerOne]);
    const auth = new FakeAuthAdmin();
    const manager = await findAppUserByAuthId(
      adminDb,
      testUsers.managerOne.authUserId,
    );

    await updateManagedUser(adminDb, auth, testUsers.managerOne.id, {
      fullName: manager!.fullName,
      role: "head",
      amoUserId: null,
      isActive: true,
      expectedUpdatedAt: manager!.updatedAt.toISOString(),
    });

    expect(auth.revoked).toEqual([testUsers.managerOne.authUserId]);
  });
});
