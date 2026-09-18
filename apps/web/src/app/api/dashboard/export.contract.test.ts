import type { DrilldownRow } from "@real2/domain";
import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "../../../lib/dashboard/csv";

const row: DrilldownRow = {
  amoLeadId: 101,
  name: "Сделка #101",
  createdDate: "2026-09-05",
  applicationAt: "2026-09-06T09:00:00.000Z",
  wonAt: null,
  manager: { id: 7, name: "Менеджер один" },
  channel: "site",
  price: "12500.00",
  amoUrl: "https://555151.amocrm.ru/leads/detail/101",
  quality: ["unknown_channel"],
};

describe("CSV export", () => {
  it("starts with a byte order mark and uses semicolons and CRLF", () => {
    const csv = toCsv([row]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toContain("ID сделки;Название");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralizes a cell a spreadsheet would treat as a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(csvCell(dangerous).startsWith("'")).toBe(true);
    }
    const injected = toCsv([{ ...row, name: "=HYPERLINK(\"http://evil\")" }]);
    expect(injected).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
  });

  it("quotes separators, quotes and newlines instead of breaking the row", () => {
    expect(csvCell("Иванов; Пётр")).toBe("\"Иванов; Пётр\"");
    expect(csvCell("Сделка \"А\"")).toBe("\"Сделка \"\"А\"\"\"");
    expect(csvCell("первая\nвторая")).toBe("\"первая\nвторая\"");
  });

  it("writes the documented columns of one lead", () => {
    const [, line] = toCsv([row]).split("\r\n");

    expect(line).toBe([
      "101",
      "Сделка #101",
      "2026-09-05",
      "2026-09-06T09:00:00.000Z",
      "",
      "Менеджер один",
      "site",
      "12500.00",
      "https://555151.amocrm.ru/leads/detail/101",
      "unknown_channel",
    ].join(";"));
  });

  it("writes only a header when the slice is empty", () => {
    expect(toCsv([]).split("\r\n").filter((line) => line !== "")).toHaveLength(1);
  });
});
