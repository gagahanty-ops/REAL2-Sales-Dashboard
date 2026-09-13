import type { AppErrorCode } from "./errors.js";

export type ApiMeta = Readonly<{
  trace_id: string;
  generated_at: string;
  snapshot_version?: number;
  source_fresh_at?: string;
  stale?: boolean;
}>;

export type ApiSuccess<T> = Readonly<{
  ok: true;
  data: T;
  meta: ApiMeta;
}>;

export type ApiFailure = Readonly<{
  ok: false;
  error: {
    code: AppErrorCode;
    message: string;
    trace_id: string;
  };
}>;

export function success<T>(
  data: T,
  meta: Omit<ApiMeta, "generated_at"> & { generated_at?: string },
): ApiSuccess<T> {
  return {
    ok: true,
    data,
    meta: {
      generated_at: meta.generated_at ?? new Date().toISOString(),
      ...meta,
    },
  };
}

export function failure(
  code: AppErrorCode,
  message: string,
  traceId: string,
): ApiFailure {
  return {
    ok: false,
    error: { code, message, trace_id: traceId },
  };
}
