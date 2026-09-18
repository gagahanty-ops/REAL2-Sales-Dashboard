import { parseDashboardFilters } from "@real2/domain";
import { describe, expect, it } from "vitest";

import {
  CHANNEL_OPTIONS,
  dashboardHref,
  filtersToSearchParams,
  selectedManagerValue,
  withChannelToggled,
  withCompare,
  withManagerSelected,
} from "./filter-url";

function filters(query: string) {
  return parseDashboardFilters(new URLSearchParams(query), { today: "2026-09-19" });
}

describe("dashboard filter URLs", () => {
  it("round-trips through the parser", () => {
    const original = filters("from=2026-09-01&to=2026-09-30&channel=site&manager=amo:7");

    expect(parseDashboardFilters(filtersToSearchParams(original), { today: "2026-09-19" }))
      .toEqual(original);
  });

  it("writes the same link for the same slice regardless of input order", () => {
    const left = filters("from=2026-09-01&to=2026-09-30&channel=site&channel=avito");
    const right = filters("from=2026-09-01&to=2026-09-30&channel=avito&channel=site");

    expect(dashboardHref("/dashboard", left)).toBe(dashboardHref("/dashboard", right));
    expect(dashboardHref("/dashboard", left)).toContain("channel=avito&channel=site");
  });

  it("keeps the comparison out of the link unless it is switched off", () => {
    expect(dashboardHref("/dashboard", filters(""))).not.toContain("compare");
    expect(dashboardHref("/dashboard", withCompare(filters(""), false)))
      .toContain("compare=none");
  });

  it("toggles a channel on and off", () => {
    const base = filters("from=2026-09-01&to=2026-09-30");
    const withSite = withChannelToggled(base, "site");

    expect(withSite.channels).toEqual(["site"]);
    expect(withChannelToggled(withSite, "site").channels).toEqual([]);
    expect(withChannelToggled(withSite, "avito").channels).toEqual(["avito", "site"]);
  });

  it("selects the department, one manager or the unassigned group", () => {
    const base = filters("from=2026-09-01&to=2026-09-30");

    expect(selectedManagerValue(base)).toBe("all");
    expect(selectedManagerValue(withManagerSelected(base, "7"))).toBe("7");
    expect(selectedManagerValue(withManagerSelected(base, "unassigned"))).toBe("unassigned");
    expect(withManagerSelected(withManagerSelected(base, "7"), "all").managerIds).toEqual([]);
  });

  it("offers every normalized channel exactly once", () => {
    const values = CHANNEL_OPTIONS.map((option) => option.value);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("unknown");
    expect(values).toHaveLength(8);
  });
});
