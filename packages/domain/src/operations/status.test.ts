import { describe, expect, it } from "vitest";

import { evaluateSystemHealth, type SystemHealthInput } from "./status.js";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function input(overrides: Partial<SystemHealthInput> = {}): SystemHealthInput {
  return {
    now: NOW,
    databaseReachable: true,
    activeConfig: true,
    currentSnapshot: { version: 42, sourceFreshAt: minutesAgo(3) },
    lastSuccessfulSyncAt: minutesAgo(2),
    consecutiveSyncFailures: 0,
    openBlockingQualityIssues: 0,
    lastPublication: null,
    amoTokenExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function codes(health: ReturnType<typeof evaluateSystemHealth>): readonly string[] {
  return health.alerts.map((alert) => alert.code);
}

describe("evaluateSystemHealth", () => {
  it("reports a healthy system without alerts", () => {
    const health = evaluateSystemHealth(input());

    expect(health.readiness).toEqual({
      ready: true,
      checks: { database: true, activeConfig: true, currentSnapshot: true },
    });
    expect(health.dashboard).toEqual({ available: true, snapshotVersion: 42, stale: false });
    expect(codes(health)).toEqual([]);
  });

  it("serves the last approved snapshot as stale when synchronization fell behind", () => {
    const health = evaluateSystemHealth(input({ lastSuccessfulSyncAt: minutesAgo(25) }));

    expect(health.dashboard).toEqual({ available: true, snapshotVersion: 42, stale: true });
    expect(codes(health)).toContain("sync_stale");
    expect(health.readiness.ready).toBe(true);
  });

  it("is not ready without a database, a configuration or a snapshot", () => {
    expect(evaluateSystemHealth(input({ databaseReachable: false })).readiness.ready)
      .toBe(false);
    expect(evaluateSystemHealth(input({ activeConfig: false })).readiness.ready).toBe(false);
    expect(evaluateSystemHealth(input({ currentSnapshot: null })).readiness.ready)
      .toBe(false);
  });

  it("says plainly that there is nothing to show when no snapshot was approved", () => {
    const health = evaluateSystemHealth(input({ currentSnapshot: null }));

    expect(health.dashboard).toMatchObject({ available: false, snapshotVersion: null });
    expect(codes(health)).toContain("snapshot_missing");
    // A missing snapshot is reported once, not as a stale one as well.
    expect(codes(health)).not.toContain("sync_stale");
  });

  it("raises a critical alert after five consecutive synchronization failures", () => {
    expect(codes(evaluateSystemHealth(input({ consecutiveSyncFailures: 4 }))))
      .not.toContain("sync_failing");
    const health = evaluateSystemHealth(input({ consecutiveSyncFailures: 5 }));
    expect(codes(health)).toContain("sync_failing");
    expect(health.alerts.find((alert) => alert.code === "sync_failing")?.severity)
      .toBe("critical");
  });

  it("warns about unaccepted blocking quality issues and an expiring token", () => {
    const health = evaluateSystemHealth(
      input({
        openBlockingQualityIssues: 2,
        amoTokenExpiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );

    expect(codes(health)).toEqual(
      expect.arrayContaining(["quality_blocking", "amo_token_expiring"]),
    );
  });

  it("separates a blocked publication from a checksum failure", () => {
    expect(
      codes(evaluateSystemHealth(input({
        lastPublication: { status: "blocked", errorCode: "E_SHEET_LAYOUT_MISMATCH" },
      }))),
    ).toContain("sheet_layout_drift");

    expect(
      codes(evaluateSystemHealth(input({
        lastPublication: { status: "failed", errorCode: "E_SHEET_UPSTREAM" },
      }))),
    ).toContain("sheet_checksum_mismatch");

    expect(
      codes(evaluateSystemHealth(input({
        lastPublication: { status: "success", errorCode: null },
      }))),
    ).toEqual([]);
  });

  it("treats a never-synchronized system as stale rather than fresh", () => {
    const health = evaluateSystemHealth(input({ lastSuccessfulSyncAt: null }));

    expect(health.dashboard.stale).toBe(true);
    expect(codes(health)).toContain("sync_stale");
  });
});
