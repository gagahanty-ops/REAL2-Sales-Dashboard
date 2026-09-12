import { describe, expect, it } from "vitest";

import { requireRole, type SessionUser } from "./authorization";

const managerUser: SessionUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "manager@example.test",
  fullName: "Manager User",
  role: "manager",
  amoUserId: 101,
};

const adminUser: SessionUser = {
  id: "10000000-0000-4000-8000-000000000010",
  email: "admin@example.test",
  fullName: "Admin User",
  role: "admin",
  amoUserId: null,
};

describe("requireRole", () => {
  it("does not trust a role supplied by request data", () => {
    expect(() =>
      requireRole(managerUser, ["admin"], { role: "admin" }),
    ).toThrowError("E_FORBIDDEN");
  });

  it("allows a server-derived active admin", () => {
    expect(requireRole(adminUser, ["admin"])).toEqual(adminUser);
  });
});
