import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../errors.js";
import type { DashboardFilters } from "./filters.js";
import type { DashboardScope } from "./scope.js";

export type DrilldownCursor = Readonly<{
  snapshotVersion: number;
  createdDate: string;
  amoLeadId: number;
  /** Hash of the slice this position belongs to. */
  filterHash: string;
}>;

const CURSOR_KEY_CONTEXT = "real2/dashboard-cursor/v1";

/**
 * Derives the cursor signing key from the server's encryption key. Separate
 * context means the cursor key can never be confused with the key that
 * protects amoCRM tokens.
 */
export function deriveCursorKey(tokenEncryptionKey: string): Buffer {
  return createHmac("sha256", Buffer.from(tokenEncryptionKey, "base64"))
    .update(CURSOR_KEY_CONTEXT)
    .digest();
}

/** Stable identity of one drill-down slice; the comparison flag is irrelevant. */
export function filterHashOf(
  slice: Readonly<{
    filters: DashboardFilters;
    scope: DashboardScope;
    metric: string;
  }>,
): string {
  const canonical = JSON.stringify([
    slice.filters.from,
    slice.filters.to,
    [...slice.filters.channels].sort(),
    slice.scope.kind,
    [...slice.scope.amoUserIds].sort((left, right) => left - right),
    slice.scope.includeUnassigned,
    slice.metric,
  ]);
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function encodeDrilldownCursor(cursor: DrilldownCursor, key: Buffer): string {
  const payload = Buffer.from(
    JSON.stringify([
      cursor.snapshotVersion,
      cursor.createdDate,
      cursor.amoLeadId,
      cursor.filterHash,
    ]),
  ).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Decodes a cursor and refuses anything that does not belong to this request:
 * a bad signature is a validation error, a position from another snapshot
 * version or another slice is a conflict, so the UI restarts the drill-down
 * instead of mixing two versions (SPEC M7.6).
 */
export function decodeDrilldownCursor(
  token: string,
  key: Buffer,
  expected: Readonly<{ snapshotVersion: number; filterHash: string }>,
): DrilldownCursor {
  const [payload, signature] = token.split(".");
  if (payload === undefined || signature === undefined || payload === "") {
    throw new AppError("E_VALIDATION", 422);
  }
  const expectedSignature = Buffer.from(sign(payload, key));
  const actualSignature = Buffer.from(signature);
  if (
    expectedSignature.length !== actualSignature.length
    || !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw new AppError("E_VALIDATION", 422);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AppError("E_VALIDATION", 422);
  }
  if (!Array.isArray(decoded) || decoded.length !== 4) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [snapshotVersion, createdDate, amoLeadId, filterHash] = decoded;
  if (
    typeof snapshotVersion !== "number"
    || typeof createdDate !== "string"
    || typeof amoLeadId !== "number"
    || typeof filterHash !== "string"
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
  if (
    snapshotVersion !== expected.snapshotVersion
    || filterHash !== expected.filterHash
  ) {
    throw new AppError("E_CONFLICT", 409);
  }
  return { snapshotVersion, createdDate, amoLeadId, filterHash };
}

/** SECURITY_READ_ONLY section 7: only the last two digits of a phone survive. */
export function maskPhone(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 2 ? `+7 *** ***-**-${digits.slice(-2)}` : null;
}
