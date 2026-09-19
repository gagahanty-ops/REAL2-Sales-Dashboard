import { AppError } from "@real2/domain";
import { describe, expect, it } from "vitest";

import {
  PROTECTED_SPREADSHEET_IDS,
  assertWritableSpreadsheetId,
  createSheetReadClient,
  createSheetWriteClient,
  type SheetClient,
} from "./policy.js";

const ORIGINAL_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";
const COPY_ID = "1CopySpreadsheetIdentifierForTests_0001";

type Harness = Readonly<{
  secretReads: () => number;
  clientCreations: () => number;
  requests: () => readonly string[];
  openReader: (spreadsheetId: string) => Promise<SheetClient>;
  openWriter: (spreadsheetId: string) => Promise<SheetClient>;
}>;

function googleHarness(
  options: Readonly<{ envEnabled: boolean; dbEnabled: boolean; targetId?: string }>,
): Harness {
  let secretReads = 0;
  let clientCreations = 0;
  const requests: string[] = [];

  const client: SheetClient = {
    async readMetadata() {
      requests.push("metadata");
      return { title: "Копия", sheets: [] };
    },
    async readValues(range) {
      requests.push(`read:${range}`);
      return [];
    },
    async writeValues(updates) {
      requests.push(`write:${updates.length}`);
      return { updatedCells: 0 };
    },
  };

  const context = {
    spreadsheetId: "",
    expectedTargetId: options.targetId ?? COPY_ID,
    secrets: {
      async readGoogleServiceAccount() {
        secretReads += 1;
        return { clientEmail: "publisher@example.iam.gserviceaccount.com", privateKey: "key" };
      },
    },
    factory: async () => {
      clientCreations += 1;
      return client;
    },
    publishEnabledInEnvironment: options.envEnabled,
    controls: {
      async isPublishEnabled() {
        return options.dbEnabled;
      },
    },
  };

  return {
    secretReads: () => secretReads,
    clientCreations: () => clientCreations,
    requests: () => requests,
    openReader: (spreadsheetId) => createSheetReadClient({ ...context, spreadsheetId }),
    openWriter: (spreadsheetId) => createSheetWriteClient({ ...context, spreadsheetId }),
  };
}

describe("assertWritableSpreadsheetId", () => {
  it("names the original spreadsheet as permanently protected", () => {
    expect(PROTECTED_SPREADSHEET_IDS.has(ORIGINAL_ID)).toBe(true);
    expect(() => assertWritableSpreadsheetId(ORIGINAL_ID, ORIGINAL_ID)).toThrow(AppError);
  });

  it("refuses the original however it is spelled", () => {
    for (const value of [ORIGINAL_ID, ` ${ORIGINAL_ID} `, `\t${ORIGINAL_ID}\n`]) {
      expect(() => assertWritableSpreadsheetId(value, COPY_ID)).toThrow(
        expect.objectContaining({ code: "E_SHEET_PROTECTED" }),
      );
    }
  });

  it("refuses any identifier that is not the configured target", () => {
    expect(() => assertWritableSpreadsheetId("1SomeOtherSpreadsheetIdentifier_002", COPY_ID))
      .toThrow(expect.objectContaining({ code: "E_FORBIDDEN" }));
  });

  it("refuses a malformed identifier instead of passing it to Google", () => {
    for (const value of ["", "short", "has spaces inside the identifier", "../../etc/passwd"]) {
      expect(() => assertWritableSpreadsheetId(value, COPY_ID)).toThrow(AppError);
    }
  });

  it("accepts the configured copy", () => {
    expect(assertWritableSpreadsheetId(` ${COPY_ID} `, COPY_ID)).toBe(COPY_ID);
  });
});

describe("Google client construction", () => {
  it("rejects the original before credentials or a client are touched", async () => {
    const harness = googleHarness({ envEnabled: true, dbEnabled: true, targetId: ORIGINAL_ID });

    await expect(harness.openWriter(ORIGINAL_ID)).rejects.toThrow(
      expect.objectContaining({ code: "E_SHEET_PROTECTED" }),
    );
    await expect(harness.openReader(ORIGINAL_ID)).rejects.toThrow(
      expect.objectContaining({ code: "E_SHEET_PROTECTED" }),
    );
    expect(harness.secretReads()).toBe(0);
    expect(harness.clientCreations()).toBe(0);
    expect(harness.requests()).toHaveLength(0);
  });

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])("requires both switches to write (env %s, database %s)", async (envEnabled, dbEnabled) => {
    const harness = googleHarness({ envEnabled, dbEnabled });

    await expect(harness.openWriter(COPY_ID)).rejects.toThrow(
      expect.objectContaining({ code: "E_FORBIDDEN" }),
    );
    expect(harness.secretReads()).toBe(0);
    expect(harness.clientCreations()).toBe(0);
  });

  it("creates a writer only when both switches are on", async () => {
    const harness = googleHarness({ envEnabled: true, dbEnabled: true });

    await expect(harness.openWriter(COPY_ID)).resolves.toBeDefined();
    expect(harness.secretReads()).toBe(1);
    expect(harness.clientCreations()).toBe(1);
  });

  it("reads metadata of the copy without the publication switches", async () => {
    const harness = googleHarness({ envEnabled: false, dbEnabled: false });

    const client = await harness.openReader(COPY_ID);
    await client.readMetadata();

    expect(harness.clientCreations()).toBe(1);
    expect(harness.requests()).toEqual(["metadata"]);
  });

  it("never asks the database when the environment switch is off", async () => {
    let controlReads = 0;
    const harness = createSheetWriteClient({
      spreadsheetId: COPY_ID,
      expectedTargetId: COPY_ID,
      publishEnabledInEnvironment: false,
      controls: {
        async isPublishEnabled() {
          controlReads += 1;
          return true;
        },
      },
      secrets: {
        async readGoogleServiceAccount() {
          throw new Error("secrets must not be read");
        },
      },
      factory: async () => {
        throw new Error("client must not be created");
      },
    });

    await expect(harness).rejects.toThrow(expect.objectContaining({ code: "E_FORBIDDEN" }));
    expect(controlReads).toBe(0);
  });
});
