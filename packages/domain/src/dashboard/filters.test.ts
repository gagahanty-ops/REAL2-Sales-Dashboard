import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { parseDashboardFilters, type DashboardFilters } from "./filters.js";

const TODAY = "2026-09-19";

function parse(query: string, today = TODAY): DashboardFilters {
  return parseDashboardFilters(new URLSearchParams(query), { today });
}

describe("parseDashboardFilters", () => {
  it("parses an inclusive Moscow creation-date interval", () => {
    expect(parse("from=2026-09-01&to=2026-09-30&channel=phone_uis")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      channels: ["phone_uis"],
      managerIds: [],
      includeUnassigned: false,
      allManagers: true,
      compare: true,
    });
  });

  it("defaults to the current month when no interval is given", () => {
    expect(parse("")).toMatchObject({ from: "2026-09-01", to: TODAY, compare: true });
  });

  it("reads the specification's manager parameter", () => {
    expect(parse("manager=amo:42")).toMatchObject({
      managerIds: [42],
      includeUnassigned: false,
      allManagers: false,
    });
    expect(parse("manager=unassigned")).toMatchObject({
      managerIds: [],
      includeUnassigned: true,
      allManagers: false,
    });
    expect(parse("manager=all")).toMatchObject({ allManagers: true });
  });

  it("accepts repeated manager and channel keys and keeps them sorted and unique", () => {
    expect(parse("manager=amo:8&manager=amo:2&manager=amo:8")).toMatchObject({
      managerIds: [2, 8],
    });
    expect(parse("channel=site&channel=avito&channel=site")).toMatchObject({
      channels: ["avito", "site"],
    });
  });

  it("treats an explicit all alongside a concrete key as the concrete key", () => {
    expect(parse("manager=all&manager=amo:42")).toMatchObject({
      managerIds: [42],
      allManagers: false,
    });
    expect(parse("channel=all&channel=site")).toMatchObject({ channels: ["site"] });
  });

  it("reads the comparison parameter of the specification", () => {
    expect(parse("compare=previous").compare).toBe(true);
    expect(parse("compare=none").compare).toBe(false);
  });

  it("accepts a 366-day interval and refuses a longer one", () => {
    expect(parse("from=2026-01-01&to=2027-01-01").from).toBe("2026-01-01");
    expect(() => parse("from=2026-01-01&to=2027-01-02")).toThrow(AppError);
  });

  it("refuses a reversed interval, a malformed date and an impossible day", () => {
    expect(() => parse("from=2026-09-10&to=2026-09-09")).toThrow(AppError);
    expect(() => parse("from=10.09.2026&to=2026-09-11")).toThrow(AppError);
    expect(() => parse("from=2026-02-30&to=2026-03-01")).toThrow(AppError);
  });

  it("refuses an unknown channel, an unknown manager form and a bad comparison", () => {
    expect(() => parse("channel=carrier-pigeon")).toThrow(AppError);
    expect(() => parse("manager=42")).toThrow(AppError);
    expect(() => parse("manager=amo:0")).toThrow(AppError);
    expect(() => parse("manager=amo:-1")).toThrow(AppError);
    expect(() => parse("compare=maybe")).toThrow(AppError);
  });

  it("refuses more keys than a dashboard filter may carry", () => {
    const channels = ["avito", "instagram", "max", "phone_uis", "site", "telegram", "whatsapp", "unknown"];
    expect(parse(channels.map((channel) => `channel=${channel}`).join("&")).channels)
      .toHaveLength(8);
    const managers = Array.from({ length: 101 }, (_, index) => `manager=amo:${index + 1}`);
    expect(() => parse(managers.join("&"))).toThrow(AppError);
  });

  it("ignores unknown query parameters instead of failing the whole request", () => {
    expect(parse("utm_source=telegram&page=2")).toMatchObject({ from: "2026-09-01" });
  });

  it("refuses an incomplete interval so a half-filtered report cannot appear", () => {
    expect(() => parse("from=2026-09-01")).toThrow(AppError);
    expect(() => parse("to=2026-09-30")).toThrow(AppError);
  });
});
