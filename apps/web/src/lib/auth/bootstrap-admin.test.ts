import { describe, expect, it, vi } from "vitest";

import {
  bootstrapFirstAdmin,
  BootstrapAdminError,
} from "./bootstrap-admin";

const input = {
  email: "  ADMIN@REAL2.EXAMPLE ",
  password: "Local-password-123!",
  fullName: "  Первый администратор  ",
};

describe("bootstrapFirstAdmin", () => {
  it("creates one normalized admin when none exists", async () => {
    const create = vi.fn().mockResolvedValue({ id: "app-user-id" });

    const result = await bootstrapFirstAdmin(input, {
      hasAdmin: vi.fn().mockResolvedValue(false),
      create,
    });

    expect(create).toHaveBeenCalledWith({
      email: "admin@real2.example",
      password: input.password,
      fullName: "Первый администратор",
      role: "admin",
      amoUserId: null,
    });
    expect(result).toEqual({ id: "app-user-id" });
  });

  it("refuses to run after an admin exists", async () => {
    const create = vi.fn();

    await expect(
      bootstrapFirstAdmin(input, {
        hasAdmin: vi.fn().mockResolvedValue(true),
        create,
      }),
    ).rejects.toBeInstanceOf(BootstrapAdminError);
    expect(create).not.toHaveBeenCalled();
  });
});
