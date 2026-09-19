import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGoogleSheetClient } from "./client.js";
import { createSheetReadClient, createSheetWriteClient } from "./policy.js";

const ORIGINAL_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";
const COPY_ID = "1CopySpreadsheetIdentifierForTests_0001";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const credentials = {
  clientEmail: "publisher@example.iam.gserviceaccount.com",
  privateKey,
};

type Recorded = Readonly<{ method: string; url: string; body: string }>;

let server: Server;
let baseUrl = "";
const requests: Recorded[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = request.url ?? "";
      requests.push({
        method: request.method ?? "",
        url,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.setHeader("content-type", "application/json");
      if (url.startsWith("/unavailable")) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: { message: "backend error" } }));
        return;
      }
      if (url.startsWith("/throttled")) {
        response.statusCode = 429;
        response.end(JSON.stringify({ error: { message: "quota" } }));
        return;
      }
      if (url === "/token") {
        response.end(JSON.stringify({ access_token: "synthetic-access-token" }));
        return;
      }
      if (url.includes("/values:batchUpdate")) {
        response.end(JSON.stringify({ totalUpdatedCells: 4 }));
        return;
      }
      if (url.includes("/values/")) {
        response.end(JSON.stringify({ values: [["10", "20"]] }));
        return;
      }
      response.end(
        JSON.stringify({
          properties: { title: "Копия отчёта" },
          sheets: [
            {
              properties: {
                title: "Каналы",
                gridProperties: { rowCount: 100, columnCount: 12 },
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  requests.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function endpoints() {
  return { tokenUrl: `${baseUrl}/token`, sheetsBaseUrl: `${baseUrl}/v4/spreadsheets` };
}

function context(access: "read" | "write", spreadsheetId = COPY_ID) {
  return {
    spreadsheetId,
    expectedTargetId: COPY_ID,
    publishEnabledInEnvironment: access === "write",
    controls: { isPublishEnabled: async () => access === "write" },
    secrets: { readGoogleServiceAccount: async () => credentials },
    factory: (creds: typeof credentials, id: string) =>
      createGoogleSheetClient(creds, id, { access, endpoints: endpoints() }),
  };
}

describe("Google Sheets client", () => {
  it("authenticates once and reads the copy's layout", async () => {
    const client = await createSheetReadClient(context("read"));
    const metadata = await client.readMetadata();

    expect(metadata.title).toBe("Копия отчёта");
    expect(metadata.sheets[0]).toMatchObject({ title: "Каналы", rowCount: 100 });
    expect(requests.filter((item) => item.url === "/token")).toHaveLength(1);
    expect(requests.every((item) => item.url.includes(COPY_ID) || item.url === "/token"))
      .toBe(true);
  });

  it("writes every mapped range in one batch", async () => {
    const client = await createSheetWriteClient(context("write"));

    const result = await client.writeValues([
      { range: "Каналы!B2:B3", values: [[1], [2]] },
      { range: "Каналы!C2:C3", values: [["10.00"], ["20.00"]] },
    ]);

    expect(result.updatedCells).toBe(4);
    const writes = requests.filter((item) => item.url.includes("batchUpdate"));
    expect(writes).toHaveLength(1);
    const body = JSON.parse(writes[0]?.body ?? "{}") as {
      valueInputOption: string;
      data: { range: string }[];
    };
    expect(body.valueInputOption).toBe("RAW");
    expect(body.data.map((item) => item.range)).toEqual(["Каналы!B2:B3", "Каналы!C2:C3"]);
  });

  it("refuses to write through a read client", async () => {
    const client = await createSheetReadClient(context("read"));

    await expect(client.writeValues([{ range: "Каналы!B2", values: [[1]] }])).rejects
      .toMatchObject({ code: "E_FORBIDDEN" });
    expect(requests.filter((item) => item.url.includes("batchUpdate"))).toHaveLength(0);
  });

  it("sends nothing at all when the target is the protected original", async () => {
    await expect(createSheetReadClient(context("read", ORIGINAL_ID))).rejects
      .toMatchObject({ code: "E_SHEET_PROTECTED" });
    await expect(createSheetWriteClient(context("write", ORIGINAL_ID))).rejects
      .toMatchObject({ code: "E_SHEET_PROTECTED" });

    expect(requests).toHaveLength(0);
  });

  it.each([
    ["unavailable", 502],
    ["throttled", 429],
  ])("maps an upstream %s reply to a safe error", async (route, status) => {
    const failing = {
      ...context("write"),
      factory: (creds: typeof credentials, id: string) =>
        createGoogleSheetClient(creds, id, {
          access: "write",
          endpoints: {
            tokenUrl: `${baseUrl}/token`,
            sheetsBaseUrl: `${baseUrl}/${route}`,
          },
        }),
    };
    const client = await createSheetWriteClient(failing);

    await expect(client.writeValues([{ range: "Каналы!B2", values: [[1]] }])).rejects
      .toMatchObject({ code: "E_SHEET_UPSTREAM", status });
  });

  it("refuses a token reply without an access token", async () => {
    const broken = {
      ...context("read"),
      factory: (creds: typeof credentials, id: string) =>
        createGoogleSheetClient(creds, id, {
          access: "read",
          endpoints: {
            tokenUrl: `${baseUrl}/v4/spreadsheets`,
            sheetsBaseUrl: `${baseUrl}/v4/spreadsheets`,
          },
        }),
    };

    await expect(createSheetReadClient(broken)).rejects.toMatchObject({
      code: "E_SHEET_UPSTREAM",
    });
  });
});
