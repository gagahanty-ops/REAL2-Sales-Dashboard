declare const rublesBrand: unique symbol;

/**
 * Canonical non-negative ruble amount with exactly two fraction digits that
 * fits PostgreSQL `numeric(14,2)`, for example `"12500.50"`. It is a string so
 * money never passes through JavaScript floating-point arithmetic.
 */
export type Rubles = string & { readonly [rublesBrand]: true };

/** Largest whole-ruble amount that fits `numeric(14,2)`. */
export const MAX_AMO_PRICE_RUBLES = 999_999_999_999;

const CANONICAL_RUBLES = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const RUBLE_DECIMAL = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/;

export type InvalidRublesReason =
  | "wrong_type"
  | "not_finite"
  | "not_an_integer"
  | "negative"
  | "out_of_range";

export type AmoRublesResult =
  | Readonly<{ status: "valid"; value: Rubles }>
  | Readonly<{ status: "missing"; value: null }>
  | Readonly<{ status: "invalid"; value: null; reason: InvalidRublesReason }>;

export function isRubles(value: unknown): value is Rubles {
  return typeof value === "string" && CANONICAL_RUBLES.test(value);
}

export function isZeroRubles(value: Rubles): boolean {
  return value === "0.00";
}

/**
 * Parses the amoCRM lead `price`, which the API defines as an integer number
 * of rubles. Anything else is reported, never coerced.
 */
export function parseAmoRubles(raw: unknown): AmoRublesResult {
  if (raw === undefined || raw === null) return { status: "missing", value: null };
  if (typeof raw !== "number") return invalid("wrong_type");
  if (!Number.isFinite(raw)) return invalid("not_finite");
  if (!Number.isInteger(raw)) return invalid("not_an_integer");
  if (raw < 0) return invalid("negative");
  if (raw > MAX_AMO_PRICE_RUBLES) return invalid("out_of_range");
  // Integers up to 1e12 are exact and print without an exponent (`-0` prints "0").
  return { status: "valid", value: `${raw}.00` as Rubles };
}

/** Parses a plain decimal ruble string exactly; returns null when malformed. */
export function parseRubleDecimal(text: string): Rubles | null {
  if (typeof text !== "string") return null;
  const match = RUBLE_DECIMAL.exec(text);
  if (!match) return null;
  const [, integer, fraction = ""] = match;
  return `${integer}.${fraction.padEnd(2, "0")}` as Rubles;
}

function invalid(reason: InvalidRublesReason): AmoRublesResult {
  return { status: "invalid", value: null, reason };
}
