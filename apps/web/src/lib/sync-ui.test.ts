import { describe, expect, it } from "vitest";

import { formatMoscowDateTime, syncHistoryPagination } from "./sync-ui";

describe("sync UI helpers", () => {
  it("formats synchronization dates in Europe/Moscow", () => {
    expect(formatMoscowDateTime(new Date("2026-09-14T23:30:00.000Z"))).toContain("02:30");
  });

  it("builds bounded sync history pagination links", () => {
    expect(syncHistoryPagination({ page: 2, pageSize: 25, total: 60 })).toEqual({
      currentPage: 2,
      totalPages: 3,
      previousHref: "/sync?page=1",
      nextHref: "/sync?page=3",
    });
    expect(syncHistoryPagination({ page: 1, pageSize: 25, total: 10 })).toMatchObject({
      previousHref: null,
      nextHref: null,
    });
  });
});
