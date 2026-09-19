import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AlertAcknowledgeButton,
} from "../alert-acknowledge-button";
import { PlanTargetForm, planTargetRequest } from "../plan-target-form";
import { QualityAcceptForm, acceptIssueRequest } from "../quality-accept-form";
import { DEFAULT_MAPPING_TEMPLATE, SheetTargetManager } from "../sheet-target-manager";
import { AttentionPanel, groupByCode } from "./attention-panel";
import { FunnelView, STUCK_THRESHOLD_SECONDS, shareOfEntry } from "./funnel-view";

describe("quality acceptance", () => {
  it("asks for a reason and sends it", () => {
    const html = renderToStaticMarkup(
      <QualityAcceptForm acceptable issueId="00000000-0000-4000-8000-000000000001" />,
    );

    expect(html).toContain("Причина, не короче 10 символов");
    expect(html).toContain("Принять");
    expect(acceptIssueRequest("подтверждено вручную")).toMatchObject({
      method: "POST",
      body: '{"reason":"подтверждено вручную"}',
    });
  });

  it("says plainly when a code may not be accepted", () => {
    const html = renderToStaticMarkup(
      <QualityAcceptForm acceptable={false} issueId="00000000-0000-4000-8000-000000000002" />,
    );

    expect(html).toContain("принять нельзя");
    expect(html).not.toContain("<form");
  });
});

describe("plan target form", () => {
  it("offers the department and every manager", () => {
    const html = renderToStaticMarkup(
      <PlanTargetForm managers={[{ value: "7", label: "Менеджер один" }]} />,
    );

    expect(html).toContain("Отдел целиком");
    expect(html).toContain("Менеджер один");
    expect(html).toContain("Выручка");
  });

  it("sends the target exactly as typed", () => {
    expect(
      planTargetRequest({
        month: "2026-09-01",
        managerKey: "all",
        metricKey: "revenue",
        targetValue: "1000000.00",
      }),
    ).toMatchObject({ method: "POST", body: expect.stringContaining('"1000000.00"') });
  });
});

describe("alert acknowledgement", () => {
  it("offers the action only when it is available", () => {
    expect(
      renderToStaticMarkup(
        <AlertAcknowledgeButton alertId="00000000-0000-4000-8000-000000000003" disabled />,
      ),
    ).not.toContain("<button");
    expect(
      renderToStaticMarkup(
        <AlertAcknowledgeButton
          alertId="00000000-0000-4000-8000-000000000003"
          disabled={false}
        />,
      ),
    ).toContain("Я увидел");
  });
});

describe("sheet target manager", () => {
  it("offers registration and a mapping template that covers both reports", () => {
    const html = renderToStaticMarkup(
      <SheetTargetManager
        targets={[
          {
            id: "00000000-0000-4000-8000-000000000004",
            spreadsheetId: "1CopySpreadsheetIdentifierForTests_0001",
            expectedTitle: "Копия отчёта",
            status: "draft",
          },
        ]}
      />,
    );

    expect(html).toContain("Зарегистрировать");
    expect(html).toContain("Проверить раскладку");
    expect(html).toContain("Активировать");
    const template = JSON.parse(DEFAULT_MAPPING_TEMPLATE) as { reportKind: string }[];
    expect(new Set(template.map((item) => item.reportKind))).toEqual(
      new Set(["channels_daily", "plan_fact"]),
    );
  });
});

describe("funnel extras", () => {
  const stages = [
    {
      statusId: 770,
      statusName: "Первичный контакт",
      openCount: 10,
      openAmountRub: "0.00",
      medianAgeSeconds: 1_000,
      averageAgeSeconds: 1_000,
    },
    {
      statusId: 771,
      statusName: "Заявка",
      openCount: 4,
      openAmountRub: "0.00",
      medianAgeSeconds: STUCK_THRESHOLD_SECONDS + 1,
      averageAgeSeconds: STUCK_THRESHOLD_SECONDS + 1,
    },
  ];

  it("computes the share of the entry stage", () => {
    expect(shareOfEntry(stages[1]!, stages)).toBe(40);
    expect(shareOfEntry(stages[0]!, [])).toBeNull();
  });

  it("lists the stage where leads sit longer than the threshold", () => {
    const html = renderToStaticMarkup(<FunnelView stages={stages} />);

    expect(html).toContain("Застряли дольше порога");
    expect(html).toContain("Заявка");
    expect(html).toContain("40 %");
  });
});

describe("attention grouping", () => {
  const rows = [
    {
      amoLeadId: 101,
      name: "Сделка #101",
      createdDate: "2026-09-05",
      manager: { id: 7, name: "Менеджер один" },
      channel: "site",
      price: null,
      amoUrl: "https://555151.amocrm.ru/leads/detail/101",
      quality: ["unknown_channel", "missing_responsible"],
    },
    {
      amoLeadId: 102,
      name: "Сделка #102",
      createdDate: "2026-09-06",
      manager: { id: 8, name: "Менеджер два" },
      channel: "avito",
      price: null,
      amoUrl: "https://555151.amocrm.ru/leads/detail/102",
      quality: ["unknown_channel"],
    },
  ];

  it("groups one lead into every reason it carries", () => {
    const groups = groupByCode(rows);

    expect(groups.map((group) => group.code)).toEqual([
      "missing_responsible",
      "unknown_channel",
    ]);
    expect(groups[1]?.rows).toHaveLength(2);
  });

  it("links a lead to its card as well as to amoCRM", () => {
    const html = renderToStaticMarkup(
      <AttentionPanel counters={{ unknown_channel: 2 }} grouped rows={rows} />,
    );

    expect(html).toContain('href="/leads/101"');
    expect(html).toContain("amoCRM");
    expect(html).toContain("Неизвестный канал: 2");
  });
});
