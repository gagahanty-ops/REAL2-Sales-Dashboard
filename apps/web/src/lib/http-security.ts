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
  // Fetch Request does not expose the peer socket. Forwarding headers remain
  // attacker-controlled until a later deployment establishes and verifies a
  // closed trusted-proxy boundary, so they cannot participate in rate limits.
  void request;
  return "unknown";
}
