import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { HISTORY_ISSUE_SEVERITY } from "../leads/build-history.js";
import { LEAD_ISSUE_SEVERITY } from "../leads/normalize-lead.js";
import {
  QUALITY_CODES,
  QUALITY_CODE_POLICY,
  isAcceptableQualityCode,
  qualityCounterKey,
  type QualityCode,
} from "./codes.js";
import { evaluateQualityGate, emptyQualitySummary } from "./gates.js";

function qualitySummary(
  overrides: Readonly<Record<string, number>> = {},
): Record<string, number> {
  return { ...emptyQualitySummary(), ...overrides };
}

describe("quality code policy", () => {
  it("covers every code the snapshot and history catalogues can raise", () => {
    for (const code of Object.keys(LEAD_ISSUE_SEVERITY)) {
      expect(QUALITY_CODE_POLICY[code as QualityCode]).toBeDefined();
    }
    for (const code of Object.keys(HISTORY_ISSUE_SEVERITY)) {
      expect(QUALITY_CODE_POLICY[code as QualityCode]).toBeDefined();
    }
  });

  it("agrees with the severities of both source catalogues", () => {
    for (const [code, severity] of Object.entries(LEAD_ISSUE_SEVERITY)) {
      expect(QUALITY_CODE_POLICY[code as QualityCode]?.severity).toBe(severity);
    }
    for (const [code, severity] of Object.entries(HISTORY_ISSUE_SEVERITY)) {
      expect(QUALITY_CODE_POLICY[code as QualityCode]?.severity).toBe(severity);
    }
  });

  it("carries the operational counters the metrics catalogue requires", () => {
    for (const code of ["stale_lead", "source_api_error", "duplicate_event"]) {
      expect(QUALITY_CODE_POLICY[code as QualityCode]).toBeDefined();
    }
  });

  it("blocks exactly the codes whose severity is blocking", () => {
    for (const [code, policy] of Object.entries(QUALITY_CODE_POLICY)) {
      expect(policy.blocks).toBe(policy.severity === "blocking");
      expect(code).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it("keeps the catalogue sorted, which is what makes gate output stable", () => {
    expect([...QUALITY_CODES]).toEqual([...QUALITY_CODES].sort());
  });

  it("refuses acceptance of the codes the specification forbids", () => {
    expect(isAcceptableQualityCode("missing_stage_history")).toBe(false);
    expect(isAcceptableQualityCode("source_api_error")).toBe(false);
    expect(isAcceptableQualityCode("won_without_valid_price")).toBe(true);
    expect(isAcceptableQualityCode("unknown_channel")).toBe(true);
  });

  it("treats an unknown code as unacceptable rather than guessing", () => {
    expect(isAcceptableQualityCode("not_a_code")).toBe(false);
  });
});

describe("evaluateQualityGate", () => {
  it.each([
    ["missing_stage_history_count", 1],
    ["won_without_valid_price_count", 1],
    ["source_api_error_count", 1],
  ])("blocks production for %s", (key, value) => {
    const result = evaluateQualityGate(qualitySummary({ [key]: value }));

    expect(result.approved).toBe(false);
    expect(result.blockingCodes).toContain(key);
  });

  it("does not block solely for an unknown channel", () => {
    expect(evaluateQualityGate(qualitySummary({ unknown_channel_count: 1 })).approved)
      .toBe(true);
  });

  it("approves an empty summary", () => {
    expect(evaluateQualityGate(qualitySummary())).toEqual({
      approved: true,
      blockingCodes: [],
    });
  });

  it("lists every blocking counter in a stable order", () => {
    const result = evaluateQualityGate(
      qualitySummary({
        won_without_valid_price_count: 2,
        missing_stage_history_count: 1,
        source_api_error_count: 3,
      }),
    );

    expect(result.blockingCodes).toEqual([
      "missing_stage_history_count",
      "source_api_error_count",
      "won_without_valid_price_count",
    ]);
  });

  it("lifts the block once an acceptable code is accepted", () => {
    const summary = qualitySummary({ won_without_valid_price_count: 1 });

    expect(
      evaluateQualityGate(summary, { acceptedCodes: ["won_without_valid_price"] }),
    ).toEqual({ approved: true, blockingCodes: [] });
  });

  it("keeps blocking an unacceptable code even when an issue was accepted", () => {
    const summary = qualitySummary({ missing_stage_history_count: 1 });

    expect(
      evaluateQualityGate(summary, {
        acceptedCodes: ["missing_stage_history", "source_api_error"],
      }).approved,
    ).toBe(false);
  });

  it("ignores an accepted code that is not in the summary", () => {
    expect(
      evaluateQualityGate(qualitySummary(), { acceptedCodes: ["unknown_channel"] })
        .approved,
    ).toBe(true);
  });

  it("refuses an unknown counter, a negative count or a fractional count", () => {
    expect(() => evaluateQualityGate(qualitySummary({ made_up_count: 1 }))).toThrow(
      AppError,
    );
    expect(() =>
      evaluateQualityGate(qualitySummary({ unknown_channel_count: -1 })),
    ).toThrow(AppError);
    expect(() =>
      evaluateQualityGate(qualitySummary({ unknown_channel_count: 1.5 })),
    ).toThrow(AppError);
  });

  it("derives the counter key from the code", () => {
    expect(qualityCounterKey("unknown_channel")).toBe("unknown_channel_count");
  });
});
