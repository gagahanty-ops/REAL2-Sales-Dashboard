import { describe, expect, it } from "vitest";

import { formatAlertEmail, sendAlertEmail, type AlertEmailInput } from "../alerts/email";

const input: AlertEmailInput = {
  environment: "production",
  code: "sync_stale",
  severity: "critical",
  firstSeenAt: new Date("2026-09-19T09:00:00.000Z"),
  lastSeenAt: new Date("2026-09-19T09:30:00.000Z"),
  occurrenceCount: 3,
  traceId: "01M2V6QAKXVY2D248F5NYA6FR6",
  runbookUrl: "https://runbooks.example.test/real2/sync",
};

describe("alert email", () => {
  it("names the environment, the code and the severity in the subject", () => {
    const message = formatAlertEmail(input);

    expect(message.subject).toBe("[REAL2 production] CRITICAL: sync_stale");
  });

  it("carries only safe operational facts", () => {
    const message = formatAlertEmail(input);

    expect(message.body).toContain("Идентификатор запроса: 01M2V6QAKXVY2D248F5NYA6FR6");
    expect(message.body).toContain("https://runbooks.example.test/real2/sync");
    expect(message.body).toContain("Повторов: 3");
    for (const forbidden of ["postgres://", "token", "Bearer", "@example.test", "password"]) {
      expect(message.body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("does nothing when no transport is configured", async () => {
    await expect(sendAlertEmail(null, input)).resolves.toBe(false);
  });

  it("sends through a configured transport exactly once", async () => {
    const sent: unknown[] = [];

    const result = await sendAlertEmail(
      { send: async (message) => { sent.push(message); } },
      input,
    );

    expect(result).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
