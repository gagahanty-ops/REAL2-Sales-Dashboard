import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_AMO_PRICE_RUBLES,
  isRubles,
  isZeroRubles,
  parseAmoRubles,
  parseRubleDecimal,
} from "./rubles.js";

describe("parseAmoRubles", () => {
  it.each([
    [0, "0.00"],
    [-0, "0.00"],
    [1, "1.00"],
    [12_500, "12500.00"],
    [999_999_999_999, "999999999999.00"],
  ])("maps amoCRM integer price %j to %s", (price, expected) => {
    expect(parseAmoRubles(price)).toEqual({ status: "valid", value: expected });
  });

  it.each([[undefined], [null]])("reports %j as missing", (price) => {
    expect(parseAmoRubles(price)).toEqual({ status: "missing", value: null });
  });

  it.each([
    ["12500", "wrong_type"],
    ["", "wrong_type"],
    [true, "wrong_type"],
    [{}, "wrong_type"],
    [[12_500], "wrong_type"],
    [12n, "wrong_type"],
    [Number.NaN, "not_finite"],
    [Number.POSITIVE_INFINITY, "not_finite"],
    [100.5, "not_an_integer"],
    [0.1 + 0.2, "not_an_integer"],
    [-1, "negative"],
    [1_000_000_000_000, "out_of_range"],
    [Number.MAX_SAFE_INTEGER + 2, "out_of_range"],
  ])("rejects %o as invalid (%s)", (price, reason) => {
    expect(parseAmoRubles(price)).toEqual({ status: "invalid", value: null, reason });
  });

  it("exposes the numeric(14,2) integer bound", () => {
    expect(MAX_AMO_PRICE_RUBLES).toBe(999_999_999_999);
  });

  it("formats every in-range integer exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_AMO_PRICE_RUBLES }), (price) => {
        const parsed = parseAmoRubles(price);
        expect(parsed).toEqual({ status: "valid", value: `${BigInt(price)}.00` });
      }),
    );
  });
});

describe("parseRubleDecimal", () => {
  it.each([
    ["0", "0.00"],
    ["0.5", "0.50"],
    ["12500.5", "12500.50"],
    ["12500.50", "12500.50"],
    ["999999999999.99", "999999999999.99"],
    ["0.01", "0.01"],
  ])("canonicalises %s to %s", (text, expected) => {
    expect(parseRubleDecimal(text)).toBe(expected);
  });

  it.each([
    "",
    " 1.00",
    "1.00 ",
    "-1.00",
    "+1.00",
    "01.00",
    "1.",
    ".50",
    "1.005",
    "1e3",
    "1,50",
    "1000000000000.00",
    "NaN",
    "１.００",
  ])("rejects %j", (text) => {
    expect(parseRubleDecimal(text)).toBeNull();
  });

  it.each([[123], [null], [undefined], [{}]])("rejects non-string input %j at runtime", (value) => {
    expect(parseRubleDecimal(value as unknown as string)).toBeNull();
  });

  it("round-trips every kopeck amount without floating point", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 99_999_999_999_999n }), (kopecks) => {
        const text = `${kopecks / 100n}.${String(kopecks % 100n).padStart(2, "0")}`;
        expect(parseRubleDecimal(text)).toBe(text);
      }),
    );
  });
});

describe("Rubles helpers", () => {
  it("recognises only canonical ruble strings", () => {
    expect(isRubles("12500.50")).toBe(true);
    expect(isRubles("12500.5")).toBe(false);
    expect(isRubles(12_500.5)).toBe(false);
  });

  it("detects zero amounts", () => {
    const zero = parseRubleDecimal("0.00");
    const cent = parseRubleDecimal("0.01");
    expect(zero && isZeroRubles(zero)).toBe(true);
    expect(cent && isZeroRubles(cent)).toBe(false);
  });
});
