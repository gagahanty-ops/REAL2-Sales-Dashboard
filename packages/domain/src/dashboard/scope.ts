import { AppError } from "../errors.js";
import type { DashboardFilters } from "./filters.js";

export type DashboardRole = "admin" | "head" | "manager";

export type DashboardSession = Readonly<{
  role: DashboardRole;
  amoUserId: number | null;
}>;

export type DashboardScope = Readonly<{
  kind: "department" | "manager";
  amoUserIds: readonly number[];
  includeUnassigned: boolean;
}>;

/** The `manager_key` values a snapshot stores for this scope. */
export function managerKeysOf(scope: DashboardScope): readonly string[] {
  const keys = [...scope.amoUserIds]
    .sort((left, right) => left - right)
    .map((id) => String(id));
  return scope.includeUnassigned ? [...keys, "unassigned"] : keys;
}

/**
 * Derives the authorization scope from the session, never from the request.
 * A manager asking for somebody else is refused rather than silently rewritten,
 * so a shared link either shows the same slice or fails loudly (SPEC M7.5,
 * M7.6).
 */
export function deriveDashboardScope(
  user: DashboardSession,
  filters: DashboardFilters,
): DashboardScope {
  if (user.role !== "manager") {
    return {
      kind: "department",
      amoUserIds: filters.managerIds,
      includeUnassigned: filters.includeUnassigned,
    };
  }

  if (user.amoUserId === null) throw new AppError("E_CONFIG_INCOMPLETE", 409);
  const requestedSomebodyElse =
    filters.includeUnassigned
    || filters.managerIds.some((id) => id !== user.amoUserId);
  if (requestedSomebodyElse) throw new AppError("E_FORBIDDEN", 403);

  return { kind: "manager", amoUserIds: [user.amoUserId], includeUnassigned: false };
}
