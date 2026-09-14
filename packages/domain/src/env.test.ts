import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  AMO_CLIENT_ID: "synthetic-client-id",
  AMO_CLIENT_SECRET: "synthetic-client-secret",
  AMO_REDIRECT_URI:
    "https://dashboard.example.invalid/api/integrations/amo/callback",
  TOKEN_ENCRYPTION_KEY:
    "bG9jYWwtc3ludGhldGljLWVuY3J5cHRpb24ta2V5ISE=",
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

  it("accepts only a sufficiently long optional trusted proxy secret", () => {
    expect(
      parseServerEnv({ ...base, TRUSTED_PROXY_SECRET: "p".repeat(32) })
        .TRUSTED_PROXY_SECRET,
    ).toBe("p".repeat(32));
    expect(() =>
      parseServerEnv({ ...base, TRUSTED_PROXY_SECRET: "too-short" }),
    ).toThrow("TRUSTED_PROXY_SECRET");
  });

  it("accepts the server-only amoCRM OAuth configuration", () => {
    const env = parseServerEnv(base);

    expect(env).toMatchObject({
      AMO_CLIENT_ID: "synthetic-client-id",
      AMO_CLIENT_SECRET: "synthetic-client-secret",
      AMO_REDIRECT_URI:
        "https://dashboard.example.invalid/api/integrations/amo/callback",
      TOKEN_ENCRYPTION_KEY:
        "bG9jYWwtc3ludGhldGljLWVuY3J5cHRpb24ta2V5ISE=",
    });
  });

  it("requires an HTTPS redirect and an exactly 32-byte encryption key", () => {
    expect(() =>
      parseServerEnv({ ...base, AMO_REDIRECT_URI: "http://example.invalid/callback" }),
    ).toThrow("AMO_REDIRECT_URI");
    expect(() =>
      parseServerEnv({
        ...base,
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64"),
      }),
    ).toThrow("TOKEN_ENCRYPTION_KEY");
  });
});
