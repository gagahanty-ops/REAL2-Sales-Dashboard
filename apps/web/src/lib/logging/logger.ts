const allowedLogKeys = new Set([
  "level",
  "message",
  "trace_id",
  "operation",
  "method",
  "normalized_path",
  "status",
  "duration_ms",
  "attempt",
  "result",
  "sync_run_id",
  "snapshot_version",
]);

export type LogInput = Record<string, unknown> & { message: string };
export type LogWriter = (line: string) => void;

const sensitiveCredentialOrSql =
  /(?:authorization|bearer\s|token\s*[:=]|secret|password|select\s|insert\s|update\s|delete\s|-----BEGIN)/i;
const phoneLike = /(?:\+?\d[\d\s()\-]{8,}\d)/;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function sanitizeValue(
  key: string,
  value: unknown,
): string | number | boolean | null {
  if (typeof value === "string") {
    if (key === "trace_id" || key === "sync_run_id") {
      return ulidPattern.test(value) ? value : "[REDACTED]";
    }
    return sensitiveCredentialOrSql.test(value) || phoneLike.test(value)
      ? "[REDACTED]"
      : value.slice(0, 240);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return "[REDACTED]";
}

export function sanitizeLog(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => allowedLogKeys.has(key))
      .map(([key, value]) => [key, sanitizeValue(key, value)]),
  );
}

export function createSafeLogger(
  write: LogWriter = (line) => console.log(line),
) {
  function emit(level: "info" | "warn" | "error", input: LogInput): void {
    write(JSON.stringify(sanitizeLog({ ...input, level })));
  }

  return {
    info(input: LogInput) {
      emit("info", input);
    },
    warn(input: LogInput) {
      emit("warn", input);
    },
    error(input: LogInput) {
      emit("error", input);
    },
  };
}

export const safeLogger = createSafeLogger();
