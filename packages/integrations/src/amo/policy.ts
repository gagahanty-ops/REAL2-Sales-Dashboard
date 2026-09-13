import { AppError } from "@real2/domain";

import type { NormalizedAmoRequest } from "./types";

const AMO_HOST = "555151.amocrm.ru";

const businessGetPaths = [
  /^\/api\/v4\/account$/,
  /^\/api\/v4\/users$/,
  /^\/api\/v4\/leads(?:\/\d+)?$/,
  /^\/api\/v4\/leads\/custom_fields$/,
  /^\/api\/v4\/leads\/pipelines(?:\/\d+(?:\/statuses)?)?$/,
  /^\/api\/v4\/events$/,
];

export function assertAmoRequestAllowed(input: {
  method: string;
  url: string;
}): NormalizedAmoRequest {
  let url: URL;

  try {
    url = new URL(input.url);
  } catch {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }

  const method = input.method.toUpperCase();

  if (
    url.protocol !== "https:" ||
    url.hostname !== AMO_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }

  if (method === "POST" && url.pathname === "/oauth2/access_token") {
    return { method, url, normalizedPath: url.pathname, kind: "oauth" };
  }

  if (method !== "GET") {
    throw new AppError("E_AMO_METHOD_DENIED", 403);
  }

  if (!businessGetPaths.some((pattern) => pattern.test(url.pathname))) {
    throw new AppError("E_AMO_PATH_DENIED", 403);
  }

  return { method, url, normalizedPath: url.pathname, kind: "business" };
}
