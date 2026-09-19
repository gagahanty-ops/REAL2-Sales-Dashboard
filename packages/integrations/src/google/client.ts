import { createSign } from "node:crypto";

import { AppError } from "@real2/domain";

import type {
  GoogleServiceAccount,
  SheetClient,
  SheetMetadata,
  SheetValueUpdate,
} from "./policy.js";

/**
 * A minimal Google Sheets client built on fetch and node:crypto. It adds no
 * dependency, keeps every request visible in one file, and speaks only the
 * three calls publication needs: metadata, values read and one batch write.
 */

export type GoogleEndpoints = Readonly<{
  tokenUrl: string;
  sheetsBaseUrl: string;
}>;

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  sheetsBaseUrl: "https://sheets.googleapis.com/v4/spreadsheets",
};

/** Sheets scope only: the service account may not touch Drive or anything else. */
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_LIFETIME_SECONDS = 3_600;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signedAssertion(
  credentials: GoogleServiceAccount,
  tokenUrl: string,
  now: number,
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: SCOPE,
      aud: tokenUrl,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(credentials.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

async function requestAccessToken(
  credentials: GoogleServiceAccount,
  endpoints: GoogleEndpoints,
  now: () => number,
): Promise<string> {
  const response = await fetch(endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(credentials, endpoints.tokenUrl, now()),
    }),
  });
  if (!response.ok) throw new AppError("E_SHEET_UPSTREAM", 502);
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new AppError("E_SHEET_UPSTREAM", 502);
  }
  return body.access_token;
}

export type CreateGoogleSheetClientOptions = Readonly<{
  endpoints?: GoogleEndpoints;
  now?: () => number;
  /** Only `write` access may send a batch update. */
  access: "read" | "write";
}>;

/**
 * Builds the client for one spreadsheet. The identifier is already checked by
 * `assertWritableSpreadsheetId`; this layer refuses a write when it was handed
 * a read-only client, so a misuse fails before a request leaves the process.
 */
export async function createGoogleSheetClient(
  credentials: GoogleServiceAccount,
  spreadsheetId: string,
  options: CreateGoogleSheetClientOptions,
): Promise<SheetClient> {
  const endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  const accessToken = await requestAccessToken(credentials, endpoints, now);
  const base = `${endpoints.sheetsBaseUrl}/${encodeURIComponent(spreadsheetId)}`;

  async function call<T>(
    path: string,
    init: Readonly<{ method: string; body?: unknown }> = { method: "GET" },
  ): Promise<T> {
    const request: RequestInit = {
      method: init.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
    };
    if (init.body !== undefined) request.body = JSON.stringify(init.body);
    const response = await fetch(`${base}${path}`, request);
    if (response.status === 429) throw new AppError("E_SHEET_UPSTREAM", 429);
    if (!response.ok) throw new AppError("E_SHEET_UPSTREAM", 502);
    return (await response.json()) as T;
  }

  return {
    async readMetadata(): Promise<SheetMetadata> {
      const body = await call<{
        properties?: { title?: unknown };
        sheets?: { properties?: {
          title?: unknown;
          gridProperties?: { rowCount?: unknown; columnCount?: unknown };
        } }[];
      }>("?fields=properties.title,sheets.properties");
      return {
        title: typeof body.properties?.title === "string" ? body.properties.title : "",
        sheets: (body.sheets ?? []).map((sheet) => ({
          title: typeof sheet.properties?.title === "string" ? sheet.properties.title : "",
          rowCount: Number(sheet.properties?.gridProperties?.rowCount ?? 0),
          columnCount: Number(sheet.properties?.gridProperties?.columnCount ?? 0),
        })),
      };
    },

    async readValues(range) {
      const body = await call<{ values?: unknown }>(
        `/values/${encodeURIComponent(range)}`,
      );
      const values = Array.isArray(body.values) ? body.values : [];
      return values.map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "")));
    },

    async writeValues(updates: readonly SheetValueUpdate[]) {
      if (options.access !== "write") throw new AppError("E_FORBIDDEN", 403);
      if (updates.length === 0) return { updatedCells: 0 };
      // One batch for the whole report: a partially written sheet is worse
      // than an unwritten one.
      const body = await call<{ totalUpdatedCells?: unknown }>(
        "/values:batchUpdate",
        {
          method: "POST",
          body: {
            valueInputOption: "RAW",
            data: updates.map((update) => ({
              range: update.range,
              values: update.values.map((row) => [...row]),
            })),
          },
        },
      );
      return { updatedCells: Number(body.totalUpdatedCells ?? 0) };
    },
  };
}
