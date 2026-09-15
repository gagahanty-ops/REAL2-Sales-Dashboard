import { describe, expect, it } from "vitest";

import { dueSyncKinds } from "./schedule";

describe("amoCRM schedules", () => {
  it("runs incrementals at five-minute boundaries only once", () => {
    expect(
      dueSyncKinds(
        new Date("2026-09-15T09:10:00.000Z"),
        new Date("2026-09-15T09:05:00.000Z"),
      ),
    ).toEqual(["incremental"]);
    expect(
      dueSyncKinds(
        new Date("2026-09-15T09:10:30.000Z"),
        new Date("2026-09-15T09:10:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("adds nightly reconciliation at 02:30 Europe/Moscow", () => {
    expect(
      dueSyncKinds(
        new Date("2026-09-14T23:30:00.000Z"),
        new Date("2026-09-14T23:25:00.000Z"),
      ),
    ).toEqual(["incremental", "nightly_reconciliation"]);
  });
});
