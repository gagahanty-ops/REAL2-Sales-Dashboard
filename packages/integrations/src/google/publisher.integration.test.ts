import { AppError, buildSheetPayload, type MappingCandidate } from "@real2/domain";
import { describe, expect, it } from "vitest";

import { computeLayoutFingerprint } from "./layout.js";
import type { SheetClient, SheetMetadata, SheetValueUpdate } from "./policy.js";
import {
  DEFAULT_RETRY_DELAYS,
  classifyPublicationError,
  publishPayload,
  withPublicationRetries,
} from "./publisher.js";

const SHEET = "каналы сентябрь 2026";

const metadata: SheetMetadata = {
  title: "Копия отчёта РЕАЛ ДВА",
  sheets: [{ title: SHEET, rowCount: 100, columnCount: 12 }],
};

const mappings: readonly MappingCandidate[] = [
  { reportKind: "channels_daily", logicalField: "report_date", sheetName: SHEET, rangeA1: "A2:A3", valueType: "date" },
  { reportKind: "channels_daily", logicalField: "leads_created", sheetName: SHEET, rangeA1: "B2:B3", valueType: "integer" },
];

function payload() {
  return buildSheetPayload({
    mappings,
    channelsDaily: [
      {
        report_date: "2026-09-05",
        channel: "site",
        leads_created: 3,
        applications: 1,
        payments: 1,
        revenue: "100.00",
      },
    ],
    planFact: [],
  });
}

type Recorder = Readonly<{
  client: SheetClient;
  batches: () => number;
  written: () => readonly SheetValueUpdate[];
}>;

function recordingClient(
  options: Readonly<{
    meta?: SheetMetadata;
    corruptReadBack?: boolean;
    failWrites?: number;
    failStatus?: number;
  }> = {},
): Recorder {
  const stored = new Map<string, string[][]>();
  let batches = 0;
  let remainingFailures = options.failWrites ?? 0;
  const written: SheetValueUpdate[] = [];

  return {
    batches: () => batches,
    written: () => written,
    client: {
      readMetadata: async () => options.meta ?? metadata,
      readValues: async (range) => stored.get(range) ?? [],
      writeValues: async (updates) => {
        batches += 1;
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new AppError("E_SHEET_UPSTREAM", options.failStatus ?? 503);
        }
        let cells = 0;
        for (const update of updates) {
          written.push(update);
          const rows = update.values.map((row) =>
            row.map((cell) => (options.corruptReadBack ? "подменено" : String(cell ?? ""))));
          stored.set(update.range, rows);
          cells += rows.length;
        }
        return { updatedCells: cells };
      },
    },
  };
}

const fingerprint = computeLayoutFingerprint(metadata);

describe("publishPayload", () => {
  it("writes every mapped range in one batch and verifies the read-back", async () => {
    const recorder = recordingClient();

    const result = await publishPayload({
      client: recorder.client,
      payload: payload(),
      expectedFingerprint: fingerprint,
    });

    expect(recorder.batches()).toBe(1);
    expect(result.cellsWritten).toBe(payload().cellCount);
    expect(result.checksum).toBe(payload().checksum);
    expect(recorder.written().map((update) => update.range)).toEqual([
      `${SHEET}!A2:A3`,
      `${SHEET}!B2:B3`,
    ]);
  });

  it("writes nothing when the layout drifted since activation", async () => {
    const recorder = recordingClient({
      meta: {
        title: "Копия отчёта РЕАЛ ДВА",
        sheets: [{ title: SHEET, rowCount: 100, columnCount: 13 }],
      },
    });

    await expect(
      publishPayload({
        client: recorder.client,
        payload: payload(),
        expectedFingerprint: fingerprint,
      }),
    ).rejects.toMatchObject({ code: "E_SHEET_LAYOUT_MISMATCH" });
    expect(recorder.batches()).toBe(0);
  });

  it("fails when the copy does not read back what was sent", async () => {
    const recorder = recordingClient({ corruptReadBack: true });

    await expect(
      publishPayload({
        client: recorder.client,
        payload: payload(),
        expectedFingerprint: fingerprint,
      }),
    ).rejects.toMatchObject({ code: "E_SHEET_UPSTREAM" });
  });

  it("touches only the mapped ranges", async () => {
    const recorder = recordingClient();

    await publishPayload({
      client: recorder.client,
      payload: payload(),
      expectedFingerprint: fingerprint,
    });

    for (const update of recorder.written()) {
      expect(update.range.startsWith(`${SHEET}!`)).toBe(true);
      expect(["A2:A3", "B2:B3"]).toContain(update.range.split("!")[1]);
    }
  });
});

describe("withPublicationRetries", () => {
  function schedule() {
    const slept: number[] = [];
    return {
      slept,
      value: {
        delaysSeconds: DEFAULT_RETRY_DELAYS,
        sleep: async (seconds: number) => {
          slept.push(seconds);
        },
      },
    };
  }

  it("retries throttling and upstream failures on the documented schedule", async () => {
    const plan = schedule();
    const recorder = recordingClient({ failWrites: 2, failStatus: 429 });

    const result = await withPublicationRetries(
      () =>
        publishPayload({
          client: recorder.client,
          payload: payload(),
          expectedFingerprint: fingerprint,
        }),
      plan.value,
    );

    expect(result.checksum).toBe(payload().checksum);
    expect(plan.slept).toEqual([1, 3]);
  });

  it("gives up after the last delay and keeps the failure", async () => {
    const plan = schedule();
    const recorder = recordingClient({ failWrites: 99, failStatus: 503 });

    await expect(
      withPublicationRetries(
        () =>
          publishPayload({
            client: recorder.client,
            payload: payload(),
            expectedFingerprint: fingerprint,
          }),
        plan.value,
      ),
    ).rejects.toMatchObject({ code: "E_SHEET_UPSTREAM" });
    expect(plan.slept).toEqual([1, 3, 9, 27, 60]);
  });

  it("never retries a layout mismatch, which is a decision and not a hiccup", async () => {
    const plan = schedule();
    const recorder = recordingClient({
      meta: { title: "Другая копия", sheets: metadata.sheets },
    });

    await expect(
      withPublicationRetries(
        () =>
          publishPayload({
            client: recorder.client,
            payload: payload(),
            expectedFingerprint: fingerprint,
          }),
        plan.value,
      ),
    ).rejects.toMatchObject({ code: "E_SHEET_LAYOUT_MISMATCH" });
    expect(plan.slept).toEqual([]);
  });
});

describe("classifyPublicationError", () => {
  it("keeps a safe code and message", () => {
    expect(classifyPublicationError(new AppError("E_SHEET_PROTECTED", 403))).toMatchObject({
      code: "E_SHEET_PROTECTED",
    });
    expect(classifyPublicationError(new Error("secret token leaked"))).toEqual({
      code: "E_INTERNAL",
      summary: "Неизвестная ошибка публикации",
    });
  });
});
