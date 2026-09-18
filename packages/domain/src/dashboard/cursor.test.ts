import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import {
  decodeDrilldownCursor,
  deriveCursorKey,
  encodeDrilldownCursor,
  filterHashOf,
  maskPhone,
} from "./cursor.js";
import { parseDashboardFilters } from "./filters.js";

const key = deriveCursorKey("Xk0NO7yPo9bcFHK1ScxNu0dYfUkAsK0hZ0FLDlYA5Ss=");
const otherKey = deriveCursorKey("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaE=");

function filters(query: string) {
  return parseDashboardFilters(new URLSearchParams(query), { today: "2026-09-19" });
}

const cursor = {
  snapshotVersion: 41,
  createdDate: "2026-09-05",
  amoLeadId: 12_345,
  filterHash: "abc123",
};

describe("drill-down cursor", () => {
  it("round-trips a position", () => {
    const token = encodeDrilldownCursor(cursor, key);

    expect(decodeDrilldownCursor(token, key, {
      snapshotVersion: 41,
      filterHash: "abc123",
    })).toEqual(cursor);
  });

  it("produces an opaque token that hides nothing useful in plain sight", () => {
    const token = encodeDrilldownCursor(cursor, key);

    expect(token).not.toContain("12345");
    // payload.signature, both URL-safe base64.
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("refuses a cursor signed with another key", () => {
    const token = encodeDrilldownCursor(cursor, otherKey);

    expect(() =>
      decodeDrilldownCursor(token, key, { snapshotVersion: 41, filterHash: "abc123" }),
    ).toThrow(AppError);
  });

  it("refuses a tampered payload", () => {
    const token = encodeDrilldownCursor(cursor, key);
    const tampered = `${token.slice(0, -2)}${token.slice(-2) === "AA" ? "AB" : "AA"}`;

    expect(() =>
      decodeDrilldownCursor(tampered, key, { snapshotVersion: 41, filterHash: "abc123" }),
    ).toThrow(AppError);
  });

  it("reports a cursor from another snapshot version as a conflict", () => {
    const token = encodeDrilldownCursor(cursor, key);

    expect(() =>
      decodeDrilldownCursor(token, key, { snapshotVersion: 42, filterHash: "abc123" }),
    ).toThrow(expect.objectContaining({ code: "E_CONFLICT" }));
  });

  it("reports a cursor from another filter set as a conflict", () => {
    const token = encodeDrilldownCursor(cursor, key);

    expect(() =>
      decodeDrilldownCursor(token, key, { snapshotVersion: 41, filterHash: "other" }),
    ).toThrow(expect.objectContaining({ code: "E_CONFLICT" }));
  });

  it("refuses a malformed token instead of guessing a position", () => {
    for (const token of ["", "not-base64url!!", "YWJj"]) {
      expect(() =>
        decodeDrilldownCursor(token, key, { snapshotVersion: 41, filterHash: "abc123" }),
      ).toThrow(AppError);
    }
  });
});

describe("filterHashOf", () => {
  it("is stable for the same slice and differs for another", () => {
    const slice = {
      filters: filters("from=2026-09-01&to=2026-09-30&channel=site"),
      scope: { kind: "department" as const, amoUserIds: [7], includeUnassigned: false },
      metric: "payments" as const,
    };

    expect(filterHashOf(slice)).toBe(filterHashOf({ ...slice }));
    expect(filterHashOf(slice)).not.toBe(
      filterHashOf({ ...slice, metric: "applications" }),
    );
    expect(filterHashOf(slice)).not.toBe(
      filterHashOf({
        ...slice,
        scope: { kind: "department", amoUserIds: [8], includeUnassigned: false },
      }),
    );
    expect(filterHashOf(slice)).not.toBe(
      filterHashOf({ ...slice, filters: filters("from=2026-09-01&to=2026-09-29&channel=site") }),
    );
  });

  it("ignores the comparison flag, which does not change the drill-down rows", () => {
    const base = {
      scope: { kind: "department" as const, amoUserIds: [], includeUnassigned: false },
      metric: "leads_created" as const,
    };

    expect(filterHashOf({ ...base, filters: filters("compare=previous") })).toBe(
      filterHashOf({ ...base, filters: filters("compare=none") }),
    );
  });
});

describe("maskPhone", () => {
  it("keeps only the last two digits", () => {
    expect(maskPhone("+7 900 123-45-67")).toBe("+7 *** ***-**-67");
    expect(maskPhone("89001234567")).toBe("+7 *** ***-**-67");
  });

  it("returns null when there is nothing safe to show", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("7")).toBeNull();
    expect(maskPhone("без телефона")).toBeNull();
  });
});
