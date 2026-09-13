import type { ZodType } from "zod";

export interface NormalizedAmoRequest {
  method: string;
  url: URL;
  normalizedPath: string;
  kind: "business" | "oauth";
}

export interface AmoTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface AmoAuditEntry {
  method: string;
  normalizedPath: string;
  responseStatus?: number;
  durationMs: number;
  traceId: string;
  result: "denied" | "success" | "error";
}

export interface AmoAuditSink {
  record(entry: AmoAuditEntry): void | Promise<void>;
}

export type AmoFetchFn = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

export interface AmoFetchRequest<T> {
  method: string;
  url: string;
  schema: ZodType<T>;
  traceId: string;
  tokenProvider: AmoTokenProvider;
  fetchFn: AmoFetchFn;
  auditSink: AmoAuditSink;
  body?: BodyInit | null;
  headers?: HeadersInit;
  redirect?: RequestRedirect;
}
