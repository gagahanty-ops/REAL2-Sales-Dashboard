import { deriveCursorKey } from "@real2/domain";

import { getServerEnv } from "../server/runtime";

let cached: Buffer | null = null;

/** Cursor signing key, derived once per process from the server key. */
export function dashboardCursorKey(): Buffer {
  cached ??= deriveCursorKey(getServerEnv().TOKEN_ENCRYPTION_KEY);
  return cached;
}
