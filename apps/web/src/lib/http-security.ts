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

export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwardedIp || "unknown").slice(0, 64);
}
