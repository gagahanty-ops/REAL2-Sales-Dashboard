import { AppError, failure, success } from "@real2/domain";
import { ulid } from "ulid";
import { ZodError } from "zod";

import { normalizeLogPathname, safeLogger } from "../logging/logger";

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type RouteExecutionContext<TRouteContext = unknown> = Readonly<{
  traceId: string;
  routeContext: TRouteContext | undefined;
}>;
export type SafeRouteHandler<T = unknown, TRouteContext = unknown> = (
  request: Request,
  context: RouteExecutionContext<TRouteContext>,
) => T | Promise<T>;

function requestTraceId(request: Request): string {
  const incoming = request.headers.get("x-trace-id")?.trim();
  return incoming && ulidPattern.test(incoming) ? incoming : ulid();
}

export function normalizeRequestPath(request: Request): string {
  try {
    return normalizeLogPathname(new URL(request.url).pathname);
  } catch {
    return "/invalid-url";
  }
}

function responseWithTrace(response: Response, traceId: string): Response {
  response.headers.set("x-trace-id", traceId);
  return response;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("E_VALIDATION", 422);
  }
}

export function withRoute<T, TRouteContext = unknown>(
  handler: SafeRouteHandler<T, TRouteContext>,
) {
  return async function route(
    request: Request,
    routeContext?: TRouteContext,
  ): Promise<Response> {
    const traceId = requestTraceId(request);
    const startedAt = performance.now();
    const baseLog = {
      operation: "http_request",
      method: request.method,
      normalized_path: normalizeRequestPath(request),
      trace_id: traceId,
    };

    try {
      const data = await handler(request, { traceId, routeContext });
      const response =
        data instanceof Response
          ? data
          : Response.json(success(data, { trace_id: traceId }));

      safeLogger.info({
        ...baseLog,
        message: "request completed",
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        result: "success",
      });
      return responseWithTrace(response, traceId);
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : error instanceof ZodError
            ? new AppError("E_VALIDATION", 422)
            : new AppError("E_INTERNAL", 500);

      safeLogger.error({
        ...baseLog,
        message: "request failed",
        status: appError.status,
        duration_ms: Math.round(performance.now() - startedAt),
        result: appError.code,
      });

      return responseWithTrace(
        Response.json(
          failure(appError.code, appError.safeMessage, traceId),
          { status: appError.status },
        ),
        traceId,
      );
    }
  };
}
