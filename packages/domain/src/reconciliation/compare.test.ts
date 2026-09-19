import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { compareManualReport, isZeroDifference } from "./compare.js";
import { parseManualReport, type ManualReportRow } from "./manual-report.js";

const HEADER = "Дата;Менеджер;Лиды;Заявки;Оплаты;Выручка";

function row(overrides: Partial<ManualReportRow> = {}): ManualReportRow {
  return {
    date: "2026-09-05",
    manager: "Патя",
    leads: 10,
    applications: 4,
    payments: 2,
    revenueRub: "20000.00",
    ...overrides,
  };
}

describe("compareManualReport", () => {
  it("reports exact count and kopeck differences without hiding missing rows", () => {
    const result = compareManualReport(
      [row()],
      [row({ applications: 5, revenueRub: "19999.99" })],
    );

    expect(result.rows[0]?.difference).toEqual({
      leads: 0,
      applications: -1,
      payments: 0,
      revenueRub: "0.01",
    });
    expect(result.accepted).toBe(false);
    expect(result.differingRows).toBe(1);
  });

  it("accepts a day where every number agrees", () => {
    const result = compareManualReport([row()], [row()]);

    expect(result.accepted).toBe(true);
    expect(result.rows[0]?.missingIn).toBeNull();
    expect(isZeroDifference(result.rows[0]!.difference)).toBe(true);
  });

  it("never treats a missing row as a zero", () => {
    const missingInSnapshot = compareManualReport([row()], []);
    const missingInManual = compareManualReport([], [row()]);

    expect(missingInSnapshot.rows[0]?.missingIn).toBe("snapshot");
    expect(missingInManual.rows[0]?.missingIn).toBe("manual");
    expect(missingInSnapshot.accepted).toBe(false);
    expect(missingInManual.accepted).toBe(false);
  });

  it("keeps rows of different managers and days apart", () => {
    const result = compareManualReport(
      [row(), row({ manager: "Марина" }), row({ date: "2026-09-06" })],
      [row(), row({ manager: "Марина" }), row({ date: "2026-09-06" })],
    );

    expect(result.rows).toHaveLength(3);
    expect(result.accepted).toBe(true);
  });

  it("detects a one-kopeck difference in either direction", () => {
    expect(
      compareManualReport([row({ revenueRub: "20000.01" })], [row()]).rows[0]?.difference
        .revenueRub,
    ).toBe("0.01");
    expect(
      compareManualReport([row()], [row({ revenueRub: "20000.01" })]).rows[0]?.difference
        .revenueRub,
    ).toBe("-0.01");
  });
});

describe("parseManualReport", () => {
  it("reads the documented export with its Russian headers", () => {
    const report = parseManualReport(
      `﻿${HEADER}\r\n05.09.2026;Патя;10;4;2;20 000,00\r\n`,
      "отчёт-сентябрь.csv",
    );

    expect(report.rows).toEqual([
      {
        date: "2026-09-05",
        manager: "Патя",
        leads: 10,
        applications: 4,
        payments: 2,
        revenueRub: "20000.00",
      },
    ]);
    expect(report.fileName).toBe("отчёт-сентябрь.csv");
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("accepts ISO dates as well", () => {
    const report = parseManualReport(`${HEADER}\n2026-09-05;Патя;1;1;1;1.00\n`, "e.csv");

    expect(report.rows[0]?.date).toBe("2026-09-05");
  });

  it("refuses an unexpected header, a formula and a duplicate key", () => {
    expect(() => parseManualReport("Дата;Менеджер;Лиды\n", "e.csv")).toThrow(AppError);
    expect(() =>
      parseManualReport(`${HEADER}\n2026-09-05;=HYPERLINK("x");1;1;1;1.00\n`, "e.csv"),
    ).toThrow(AppError);
    expect(() =>
      parseManualReport(
        `${HEADER}\n2026-09-05;Патя;1;1;1;1.00\n2026-09-05;Патя;2;2;2;2.00\n`,
        "e.csv",
      ),
    ).toThrow(expect.objectContaining({ code: "E_CONFLICT" }));
  });

  it("refuses an unreadable number, an empty manager and an empty file", () => {
    expect(() => parseManualReport(`${HEADER}\n2026-09-05;Патя;десять;1;1;1.00\n`, "e.csv"))
      .toThrow(AppError);
    expect(() => parseManualReport(`${HEADER}\n2026-09-05;;1;1;1;1.00\n`, "e.csv"))
      .toThrow(AppError);
    expect(() => parseManualReport(`${HEADER}\n`, "e.csv")).toThrow(AppError);
  });

  it("keeps a quoted manager name with a separator inside", () => {
    const report = parseManualReport(
      `${HEADER}\n2026-09-05;"Иванов; Пётр";1;1;1;1.00\n`,
      "e.csv",
    );

    expect(report.rows[0]?.manager).toBe("Иванов; Пётр");
  });

  it("gives the same hash for the same bytes and a different one otherwise", () => {
    const first = parseManualReport(`${HEADER}\n2026-09-05;Патя;1;1;1;1.00\n`, "a.csv");
    const same = parseManualReport(`${HEADER}\n2026-09-05;Патя;1;1;1;1.00\n`, "b.csv");
    const other = parseManualReport(`${HEADER}\n2026-09-05;Патя;2;1;1;1.00\n`, "a.csv");

    expect(same.sha256).toBe(first.sha256);
    expect(other.sha256).not.toBe(first.sha256);
  });
});
