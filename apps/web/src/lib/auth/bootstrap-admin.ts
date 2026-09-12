import type { AppUser } from "@real2/db";

import type { CreateManagedUserInput } from "./user-admin";

export type BootstrapAdminInput = Readonly<{
  email: string;
  password: string;
  fullName: string;
}>;

export type BootstrapAdminDependencies = Readonly<{
  hasAdmin(): Promise<boolean>;
  create(input: CreateManagedUserInput): Promise<Pick<AppUser, "id">>;
}>;

export class BootstrapAdminError extends Error {
  readonly code = "E_BOOTSTRAP_LOCKED" as const;

  constructor() {
    super("Первичный администратор уже существует");
    this.name = "BootstrapAdminError";
  }
}

export async function bootstrapFirstAdmin(
  input: BootstrapAdminInput,
  dependencies: BootstrapAdminDependencies,
): Promise<Pick<AppUser, "id">> {
  if (await dependencies.hasAdmin()) {
    throw new BootstrapAdminError();
  }

  return dependencies.create({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    fullName: input.fullName.trim(),
    role: "admin",
    amoUserId: null,
  });
}
