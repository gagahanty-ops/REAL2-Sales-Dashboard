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

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeResultPattern = /^(?:success|allowed|denied|error|disabled|partial|failed|idle|E_[A-Z0-9_]{2,64})$/;

const safeStringValues = new Map<string, ReadonlySet<string>>([
  ["level", new Set(["info", "warn", "error"])],
  ["message", new Set(["request completed", "request failed"])],
  ["operation", new Set(["http_request"])],
  ["method", new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])],
]);

const safeLogPathSegments = new Set([
  "admin",
  "api",
  "auth",
  "health",
  "leads",
  "live",
  "login",
  "logout",
  "me",
  "settings",
  "users",
]);

const dynamicPathSegment =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i;

export function normalizeLogPathname(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#")) {
    return "/invalid-url";
  }

  return pathname
    .split("/")
    .map((segment) => {
      if (!segment || safeLogPathSegments.has(segment)) return segment;
      if (segment === ":id" || dynamicPathSegment.test(segment)) return ":id";
      return ":segment";
    })
    .join("/");
}

function isCanonicalNormalizedPath(value: string): boolean {
  return value.length <= 240 && normalizeLogPathname(value) === value;
}

function sanitizeValue(
  key: string,
  value: unknown,
): string | number | boolean | null {
  if (typeof value === "string") {
    if (key === "trace_id") return ulidPattern.test(value) ? value : "[REDACTED]";
    if (key === "sync_run_id") {
      return ulidPattern.test(value) || uuidPattern.test(value)
        ? value
        : "[REDACTED]";
    }
    if (key === "normalized_path") {
      return isCanonicalNormalizedPath(value) ? value : "[REDACTED]";
    }
    if (key === "result") {
      return safeResultPattern.test(value) ? value : "[REDACTED]";
    }
    return safeStringValues.get(key)?.has(value) ? value : "[REDACTED]";
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
