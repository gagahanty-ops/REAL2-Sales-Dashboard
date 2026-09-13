import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { getServerEnv } from "./server/runtime";
import { AppError } from "@real2/domain";

export class RequestSecurityError extends AppError {
  constructor() {
    super("E_FORBIDDEN", 403, "Запрос отклонён");
    this.name = "RequestSecurityError";
  }
}

export function requireSameOrigin(
  request: Request,
  appUrl = getServerEnv().APP_URL,
): void {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(appUrl).origin;

  let receivedOrigin: string | null = null;
  try {
    receivedOrigin = origin ? new URL(origin).origin : null;
  } catch {
    throw new RequestSecurityError();
  }

  if (receivedOrigin !== expectedOrigin) {
    throw new RequestSecurityError();
  }
}

export type ClientIpOptions = Readonly<{
  appUrl: string;
  trustedProxySecret?: string;
}>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function hasTrustedProxySecret(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

function defaultClientIpOptions(): ClientIpOptions {
  const env = getServerEnv();
  return {
    appUrl: env.APP_URL,
    ...(env.TRUSTED_PROXY_SECRET
      ? { trustedProxySecret: env.TRUSTED_PROXY_SECRET }
      : {}),
  };
}

export function getClientIp(
  request: Request,
  options: ClientIpOptions = defaultClientIpOptions(),
): string {
  const appHost = new URL(options.appUrl).hostname;
  if (appHost === "localhost" || appHost === "127.0.0.1" || appHost === "[::1]") {
    return "loopback";
  }

  const receivedProxySecret = request.headers.get("x-real2-proxy-secret");
  if (
    !options.trustedProxySecret ||
    !receivedProxySecret ||
    !hasTrustedProxySecret(receivedProxySecret, options.trustedProxySecret)
  ) {
    throw new RequestSecurityError();
  }

  const clientIp = request.headers.get("x-real-ip")?.trim();
  if (!clientIp || isIP(clientIp) === 0) throw new RequestSecurityError();
  return clientIp;
}
