import { describe, expect, it } from "vitest";

import { createLogCapture } from "@real2/testkit";
import {
  createSafeLogger,
  sanitizeLog,
} from "../../apps/web/src/lib/logging/logger";

describe("safe structured logging", () => {
  it("keeps allowlisted operational fields only", () => {
    expect(
      sanitizeLog({
        level: "info",
        message: "request completed",
        trace_id: "01J00000000000000000000000",
        status: 200,
        phone: "+7 999 111-22-33",
        full_name: "Секретный Клиент",
        token: "amo-secret",
        sql: "select * from app_users",
        body: { password: "password-secret" },
      }),
    ).toEqual({
      level: "info",
      message: "request completed",
      trace_id: "01J00000000000000000000000",
      status: 200,
    });
  });

  it("writes one JSON record without secret or PII values", () => {
    const capture = createLogCapture();
    const logger = createSafeLogger(capture.write);

    logger.info({
      message: "request completed token=amo-secret select * from app_users",
      operation: "http_request",
      trace_id: "01J00000000000000000000000",
      status: 200,
      token: "amo-secret",
      phone: "+7 999 111-22-33",
    });

    expect(capture.records()).toEqual([
      {
        level: "info",
        message: "[REDACTED]",
        operation: "http_request",
        trace_id: "01J00000000000000000000000",
        status: 200,
      },
    ]);
    expect(capture.lines.join("\n")).not.toMatch(/amo-secret|999 111/i);
  });

  it("defaults every allowlisted free-form string to redacted", () => {
    const sensitive =
      'Иван Иванов custom_field={"address":"Махачкала"} code=oauth-code-123';

    expect(
      sanitizeLog({
        message: sensitive,
        operation: sensitive,
        method: sensitive,
        normalized_path: `/${sensitive}`,
        result: sensitive,
        snapshot_version: sensitive,
      }),
    ).toEqual({
      message: "[REDACTED]",
      operation: "[REDACTED]",
      method: "[REDACTED]",
      normalized_path: "[REDACTED]",
      result: "[REDACTED]",
      snapshot_version: "[REDACTED]",
    });
  });
});
