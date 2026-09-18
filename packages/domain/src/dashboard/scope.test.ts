import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { parseDashboardFilters, type DashboardFilters } from "./filters.js";
import { deriveDashboardScope, managerKeysOf, type DashboardSession } from "./scope.js";

function filters(query = ""): DashboardFilters {
  return parseDashboardFilters(new URLSearchParams(query), { today: "2026-09-19" });
}

function session(
  role: DashboardSession["role"],
  amoUserId: number | null = null,
): DashboardSession {
  return { role, amoUserId };
}

describe("deriveDashboardScope", () => {
  it("gives leadership the department scope with the requested managers", () => {
    expect(deriveDashboardScope(session("admin"), filters("manager=amo:8"))).toEqual({
      kind: "department",
      amoUserIds: [8],
      includeUnassigned: false,
    });
    expect(deriveDashboardScope(session("head"), filters())).toEqual({
      kind: "department",
      amoUserIds: [],
      includeUnassigned: false,
    });
  });

  it("scopes a manager to their own amoCRM user", () => {
    expect(deriveDashboardScope(session("manager", 42), filters())).toEqual({
      kind: "manager",
      amoUserIds: [42],
      includeUnassigned: false,
    });
    expect(deriveDashboardScope(session("manager", 42), filters("manager=amo:42"))).toEqual({
      kind: "manager",
      amoUserIds: [42],
      includeUnassigned: false,
    });
  });

  it("refuses a manager asking for somebody else instead of quietly rewriting it", () => {
    expect(() => deriveDashboardScope(session("manager", 42), filters("manager=amo:8")))
      .toThrow(AppError);
    expect(() => deriveDashboardScope(session("manager", 42), filters("manager=unassigned")))
      .toThrow(AppError);
    expect(() =>
      deriveDashboardScope(session("manager", 42), filters("manager=amo:42&manager=amo:8")),
    ).toThrow(AppError);
  });

  it("lets a manager keep an explicit all, which still means only themselves", () => {
    expect(deriveDashboardScope(session("manager", 42), filters("manager=all"))).toEqual({
      kind: "manager",
      amoUserIds: [42],
      includeUnassigned: false,
    });
  });

  it("refuses a manager session without an amoCRM mapping", () => {
    expect(() => deriveDashboardScope(session("manager", null), filters())).toThrow(AppError);
  });

  it("keeps the unassigned group available to leadership", () => {
    expect(deriveDashboardScope(session("head"), filters("manager=unassigned"))).toEqual({
      kind: "department",
      amoUserIds: [],
      includeUnassigned: true,
    });
  });

  it("translates a scope into the manager keys stored in a snapshot", () => {
    expect(managerKeysOf({ kind: "manager", amoUserIds: [42], includeUnassigned: false }))
      .toEqual(["42"]);
    expect(managerKeysOf({ kind: "department", amoUserIds: [8, 2], includeUnassigned: true }))
      .toEqual(["2", "8", "unassigned"]);
    expect(managerKeysOf({ kind: "department", amoUserIds: [], includeUnassigned: false }))
      .toEqual([]);
  });
});
