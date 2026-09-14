import { type AmoAuditEntry, type AmoAuditSink } from "@real2/integrations";

import { safeLogger } from "../logging/logger";

export function createAmoAdminAuditSink(): AmoAuditSink {
  return {
    record(entry: AmoAuditEntry) {
      const completed = entry.result === "success";
      const log = completed ? safeLogger.info : safeLogger.error;
      log({
        message: completed ? "request completed" : "request failed",
        operation: "http_request",
        method: entry.method,
        normalized_path: entry.normalizedPath,
        ...(entry.responseStatus !== undefined
          ? { status: entry.responseStatus }
          : {}),
        duration_ms: entry.durationMs,
        trace_id: entry.traceId,
        result: entry.result,
      });
    },
  };
}
