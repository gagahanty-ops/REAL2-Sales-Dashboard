import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
};

describe("parseServerEnv", () => {
  it("defaults both network switches to false", () => {
    const env = parseServerEnv(base);

    expect(env.SYNC_ENABLED).toBe(false);
    expect(env.SHEET_PUBLISH_ENABLED).toBe(false);
  });

  it("enables a switch only for the exact true literal", () => {
    const env = parseServerEnv({ ...base, SYNC_ENABLED: "true" });

    expect(env.SYNC_ENABLED).toBe(true);
    expect(() => parseServerEnv({ ...base, SYNC_ENABLED: "TRUE" })).toThrow(
      "SYNC_ENABLED",
    );
  });

  it("rejects a malformed database URL without exposing its value", () => {
    const parseMalformedEnv = () =>
      parseServerEnv({ ...base, DATABASE_URL: "secret-value" });

    expect(parseMalformedEnv).toThrow("DATABASE_URL");
    expect(parseMalformedEnv).not.toThrow("secret-value");
  });
});
