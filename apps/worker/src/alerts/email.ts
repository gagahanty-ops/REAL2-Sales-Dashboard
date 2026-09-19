export type AlertEmail = Readonly<{
  subject: string;
  body: string;
}>;

export type AlertEmailInput = Readonly<{
  environment: string;
  code: string;
  severity: "info" | "warning" | "critical";
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  traceId: string;
  runbookUrl: string;
}>;

export type EmailTransport = Readonly<{
  send(message: AlertEmail): Promise<void>;
}>;

const SEVERITY_LABEL = {
  info: "информация",
  warning: "предупреждение",
  critical: "критично",
} as const;

/**
 * Formats an alert for email. The message carries only what an operator needs
 * to act: environment, code, severity, when it started and last happened, the
 * trace identifier and a runbook link. No payload, no personal data, no
 * connection string and no token ever reaches the mail transport.
 */
export function formatAlertEmail(input: AlertEmailInput): AlertEmail {
  return {
    subject: `[REAL2 ${input.environment}] ${input.severity.toUpperCase()}: ${input.code}`,
    body: [
      `Среда: ${input.environment}`,
      `Код: ${input.code}`,
      `Важность: ${SEVERITY_LABEL[input.severity]}`,
      `Впервые: ${input.firstSeenAt.toISOString()}`,
      `Последний раз: ${input.lastSeenAt.toISOString()}`,
      `Повторов: ${input.occurrenceCount}`,
      `Идентификатор запроса: ${input.traceId}`,
      `Инструкция: ${input.runbookUrl}`,
    ].join("\n"),
  };
}

/** Sends an alert when a transport is configured; otherwise it is a no-op. */
export async function sendAlertEmail(
  transport: EmailTransport | null,
  input: AlertEmailInput,
): Promise<boolean> {
  if (!transport) return false;
  await transport.send(formatAlertEmail(input));
  return true;
}
