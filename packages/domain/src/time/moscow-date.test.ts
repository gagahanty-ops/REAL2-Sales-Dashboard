import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { parseIsoInstant, toMoscowDate, unixSecondsToInstant } from "./moscow-date.js";

describe("toMoscowDate", () => {
  it.each([
    ["2026-09-11T20:59:59Z", "2026-09-11"],
    ["2026-09-11T21:00:00Z", "2026-09-12"],
    ["2026-09-11T20:59:59.999Z", "2026-09-11"],
    ["2026-12-31T21:00:00.000Z", "2027-01-01"],
    ["2026-02-28T21:00:00Z", "2026-03-01"],
    ["2028-02-28T21:00:00Z", "2028-02-29"],
    ["2026-09-12T00:30:00+03:00", "2026-09-12"],
    ["2026-09-11T23:30:00-01:00", "2026-09-12"],
    // Moscow used UTC+4 between 2011-03-27 and 2014-10-26.
    ["2013-06-01T20:30:00Z", "2013-06-02"],
    ["2013-06-01T19:59:59Z", "2013-06-01"],
  ])("maps %s to Moscow business date %s", (instant, expected) => {
    expect(toMoscowDate(instant)).toBe(expected);
  });

  it("accepts a valid Date object", () => {
    expect(toMoscowDate(new Date("2026-09-11T21:00:00Z"))).toBe("2026-09-12");
  });

  it.each([
    "",
    "2026-09-11",
    "2026-09-11T21:00:00",
    "2026-09-11 21:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-09-11T24:00:00Z",
    "2026-09-11T21:60:00Z",
    "2026-09-11T21:00:00+15:00",
    "not a date",
    "１２３",
    "9999-12-31T21:00:00Z",
    "0500-01-01T00:00:00Z",
    "1969-12-31T23:59:59Z",
    "2026-09-11T21:00:00+14:59",
    "2026-09-11T21:00:00+03:07",
    "+010000-01-01T00:00:00Z",
  ])("rejects ambiguous or malformed instant %j", (instant) => {
    expect(() => toMoscowDate(instant)).toThrow(AppError);
  });

  it.each(["2026-09-11T21:00:00+14:00", "2026-09-11T21:00:00+05:45", "2026-09-11T21:00:00-09:30"])(
    "accepts a real-world UTC offset %s",
    (instant) => {
      expect(parseIsoInstant(instant)?.getTime()).toBe(new Date(instant).getTime());
    },
  );

  it("rejects an invalid Date object", () => {
    expect(() => toMoscowDate(new Date(Number.NaN))).toThrow(AppError);
  });

  it("matches a fixed UTC+3 offset for every instant after 2014-10-26", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.UTC(2014, 9, 26, 0, 0, 0),
          max: Date.UTC(2099, 11, 31, 20, 59, 59),
        }),
        (milliseconds) => {
          const expected = new Date(milliseconds + 3 * 3_600_000)
            .toISOString()
            .slice(0, 10);
          expect(toMoscowDate(new Date(milliseconds))).toBe(expected);
          expect(toMoscowDate(new Date(milliseconds).toISOString())).toBe(expected);
        },
      ),
    );
  });
});

describe("unixSecondsToInstant", () => {
  it("converts amoCRM unix seconds to a canonical UTC instant", () => {
    expect(unixSecondsToInstant(1_789_160_400)).toBe("2026-09-11T21:00:00.000Z");
  });

  it.each([
    [undefined],
    [null],
    [0],
    [-1],
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    ["1789160400"],
    [253_402_300_800],
    [253_402_290_000],
    [Number.MAX_SAFE_INTEGER + 1],
    [{}],
  ])("returns null for malformed timestamp %j", (value) => {
    expect(unixSecondsToInstant(value)).toBeNull();
  });

  it("accepts the last second whose Moscow date still has four year digits", () => {
    expect(unixSecondsToInstant(253_402_289_999)).toBe("9999-12-31T20:59:59.000Z");
    expect(unixSecondsToInstant(253_402_290_000)).toBeNull();
  });
});
