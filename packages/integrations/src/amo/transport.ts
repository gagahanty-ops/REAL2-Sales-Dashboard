import { AppError } from "@real2/domain";

import { assertAmoRequestAllowed } from "./policy";
import type {
  AmoAuditEntry,
  AmoFetchRequest,
  NormalizedAmoRequest,
} from "./types";

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function recordAudit(
  request: AmoFetchRequest<unknown>,
  entry: AmoAuditEntry,
): Promise<void> {
  await request.auditSink.record(entry);
}

function deniedRedirect(): AppError {
  return new AppError("E_AMO_PATH_DENIED", 403);
}

function upstreamError(): AppError {
  return new AppError("E_AMO_UPSTREAM", 502);
}

export async function amoFetch<T>(request: AmoFetchRequest<T>): Promise<T> {
  const startedAt = Date.now();
  let normalized: NormalizedAmoRequest;

  try {
    normalized = assertAmoRequestAllowed(request);
    if (request.redirect !== undefined && request.redirect !== "error") {
      throw deniedRedirect();
    }
  } catch (error) {
    const normalizedPath = safeNormalizedPath(request.url);
    await recordAudit(request, {
      method: request.method.toUpperCase(),
      normalizedPath,
      durationMs: durationSince(startedAt),
      traceId: request.traceId,
      result: "denied",
    });
    throw error;
  }

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  let responseStatus: number | undefined;

  try {
    if (normalized.kind === "business") {
      const accessToken = await request.tokenProvider.getAccessToken();
      headers.set("authorization", `Bearer ${accessToken}`);
    }

    const response = await request.fetchFn(normalized.url, {
      method: normalized.method,
      headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: "error",
    });
    responseStatus = response.status;

    if (!response.ok) {
      throw upstreamError();
    }

    const parsed = request.schema.safeParse(await response.json());
    if (!parsed.success) {
      throw upstreamError();
    }

    await recordAudit(request, {
      method: normalized.method,
      normalizedPath: normalized.normalizedPath,
      responseStatus,
      durationMs: durationSince(startedAt),
      traceId: request.traceId,
      result: "success",
    });

    return parsed.data;
  } catch (error) {
    await recordAudit(request, {
      method: normalized.method,
      normalizedPath: normalized.normalizedPath,
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      durationMs: durationSince(startedAt),
      traceId: request.traceId,
      result: "error",
    });

    if (error instanceof AppError) {
      throw error;
    }

    throw upstreamError();
  }
}

function safeNormalizedPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "/";
  }
}
