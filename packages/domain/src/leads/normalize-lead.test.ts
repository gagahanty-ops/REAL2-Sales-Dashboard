import {
  SYNTHETIC_CONFIG_ID,
  SYNTHETIC_LEAD_ACCOUNT_ID,
  SYNTHETIC_PIPELINE_ID,
  SYNTHETIC_WON_STATUS_ID,
  buildChannelRule,
  buildNormalizeLeadContext,
  buildRawLead,
} from "@real2/testkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { toMoscowDate } from "../time/moscow-date.js";
import { normalizeLead, type NormalizedLeadResult } from "./normalize-lead.js";

const context = buildNormalizeLeadContext();

function codes(result: NormalizedLeadResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

it.each([
  ["2026-09-11T20:59:59Z", "2026-09-11"],
  ["2026-09-11T21:00:00Z", "2026-09-12"],
])("maps %s to Moscow business date %s", (instant, expected) => {
  expect(toMoscowDate(instant)).toBe(expected);
});

it("does not infer Instagram from a deal name", () => {
  const result = normalizeLead(buildRawLead({ name: "Instagram Мария", customSource: null, tags: [] }), context);
  expect(result.lead?.normalizedChannel).toBe("unknown");
  expect(result.issues.map((issue) => issue.code)).toContain("unknown_channel");
});

describe("normalizeLead", () => {
  it("normalizes a complete lead snapshot", () => {
    const result = normalizeLead(buildRawLead(), context);
    expect(result).toEqual({
      status: "normalized",
      lead: {
        accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
        amoLeadId: 101,
        pipelineId: SYNTHETIC_PIPELINE_ID,
        currentStatusId: 770,
        currentResponsibleUserId: 501,
        name: "Синтетическая сделка",
        displayName: "Синтетическая сделка",
        priceRub: "12500.00",
        createdAt: "2026-09-05T09:00:00.000Z",
        createdDate: "2026-09-05",
        sourceUpdatedAt: "2026-09-10T10:00:00.000Z",
        normalizedChannel: "phone_uis",
        channelRuleId: context.channelRules[0]!.id,
        normalizationConfigId: SYNTHETIC_CONFIG_ID,
        amoUrl: "https://555151.amocrm.ru/leads/detail/101",
        isDeleted: false,
        normalizedAt: "2026-09-17T12:00:00.000Z",
      },
      issues: [],
    });
  });

  it("uses the Moscow calendar day of created_at near midnight", () => {
    const before = normalizeLead(buildRawLead({ createdAt: 1_789_160_399 }), context);
    const after = normalizeLead(buildRawLead({ createdAt: 1_789_160_400 }), context);
    expect(before.lead?.createdDate).toBe("2026-09-11");
    expect(after.lead?.createdAt).toBe("2026-09-11T21:00:00.000Z");
    expect(after.lead?.createdDate).toBe("2026-09-12");
  });

  describe("names", () => {
    it.each([[""], ["   "], ["\n\t"], [null], [undefined], [42], [{}]])(
      "uses a stable fallback for empty or non-text name %j without an issue",
      (name) => {
        const result = normalizeLead(buildRawLead({ name }), context);
        expect(result.lead?.name).toBe("Сделка #101");
        expect(result.lead?.displayName).toBe("Сделка #101");
        expect(result.issues).toEqual([]);
      },
    );

    it.each(["+7 (000) 111-22-33", "80001112233", "+7 000 111 22 33 Иван", "tel 70001112233"])(
      "keeps the protected phone-like name %j but hides it from display",
      (name) => {
        const result = normalizeLead(buildRawLead({ name }), context);
        expect(result.lead?.name).toBe(name);
        expect(result.lead?.displayName).toBe("Сделка #101");
        expect(result.issues).toEqual([]);
      },
    );

    it.each([
      ["Мария Иванова заказ кухни +7 000 111-22-33", "Мария Иванова заказ кухни *** ***-**-33"],
      ["Кухня, звонить 8 (000) 111 22 44 после 18:00", "Кухня, звонить *** ***-**-44 после 18:00"],
      ["Шкаф 80001112255 и 80001112266, доставка по городу после обеда", "Шкаф *** ***-**-55 и *** ***-**-66, доставка по городу после обеда"],
    ])("masks a phone number inside a longer name %j", (name, displayName) => {
      const result = normalizeLead(buildRawLead({ name }), context);
      expect(result.lead?.name).toBe(name);
      expect(result.lead?.displayName).toBe(displayName);
    });

    it.each(["\u200b", "\u200b\u200e\u2066", "\u00ad"])(
      "treats an invisible-only name %j as empty",
      (name) => {
        const result = normalizeLead(buildRawLead({ name }), context);
        expect(result.lead?.name).toBe("Сделка #101");
        expect(result.lead?.displayName).toBe("Сделка #101");
      },
    );

    it.each(["Заказ 12", "Кухня 2400x600", "Доставка 17.09 до 18:00", "Шкаф-купе 1234"])(
      "keeps an ordinary name with digits %j visible",
      (name) => {
        expect(normalizeLead(buildRawLead({ name }), context).lead?.displayName).toBe(name);
      },
    );
  });

  describe("price", () => {
    it("keeps an exact two-decimal price for an open lead", () => {
      expect(normalizeLead(buildRawLead({ price: 999_999_999_999 }), context).lead?.priceRub)
        .toBe("999999999999.00");
    });

    it("allows zero for an open lead", () => {
      const result = normalizeLead(buildRawLead({ price: 0 }), context);
      expect(result.lead?.priceRub).toBe("0.00");
      expect(result.issues).toEqual([]);
    });

    it("stores null without an issue when an open lead has no price", () => {
      const result = normalizeLead(buildRawLead({ omit: ["price"] }), context);
      expect(result.lead?.priceRub).toBeNull();
      expect(result.issues).toEqual([]);
    });

    it.each([
      ["12500", "wrong_type"],
      [100.5, "not_an_integer"],
      [-1, "negative"],
      [1_000_000_000_000, "out_of_range"],
    ])("warns about invalid open-lead price %j", (price, reason) => {
      const result = normalizeLead(buildRawLead({ price }), context);
      expect(result.status).toBe("normalized");
      expect(result.lead?.priceRub).toBeNull();
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "invalid_price",
          severity: "warning",
          safeDetails: { reason },
        },
      ]);
    });

    it("accepts a valid positive price for a won lead", () => {
      const result = normalizeLead(
        buildRawLead({ statusId: SYNTHETIC_WON_STATUS_ID, price: 25_000 }),
        context,
      );
      expect(result.lead?.priceRub).toBe("25000.00");
      expect(result.issues).toEqual([]);
    });

    it.each([
      [0, "zero", "0.00"],
      ["25000", "wrong_type", null],
      [-25_000, "negative", null],
      [25_000.5, "not_an_integer", null],
      [1_000_000_000_000, "out_of_range", null],
      [null, "missing", null],
    ])("blocks a won lead with price %j (%s)", (price, reason, stored) => {
      const result = normalizeLead(
        buildRawLead({ statusId: SYNTHETIC_WON_STATUS_ID, price }),
        context,
      );
      expect(result.status).toBe("normalized");
      expect(result.lead?.priceRub).toBe(stored);
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "won_without_valid_price",
          severity: "blocking",
          safeDetails: { reason },
        },
      ]);
    });
  });

  describe("channel", () => {
    it("reports an unmapped source field without leaking its text", () => {
      const result = normalizeLead(buildRawLead({ customSource: "Секретная рекомендация Ивана" }), context);
      expect(result.lead?.normalizedChannel).toBe("unknown");
      expect(result.lead?.channelRuleId).toBeNull();
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "unknown_channel",
          severity: "warning",
          safeDetails: { reason: "unmapped_source_field" },
        },
      ]);
      expect(JSON.stringify(result.issues)).not.toContain("Иван");
    });

    it("reports conflicting rules as unknown with both issues", () => {
      const conflictContext = buildNormalizeLeadContext({
        channelRules: [
          buildChannelRule({ id: "tag-a", priority: 1, matchType: "tag_exact", matchValue: "a", normalizedChannel: "avito" }),
          buildChannelRule({ id: "tag-b", priority: 2, matchType: "tag_exact", matchValue: "b", normalizedChannel: "site" }),
        ],
      });
      const result = normalizeLead(buildRawLead({ customSource: null, tags: ["a", "b"] }), conflictContext);
      expect(result.lead?.normalizedChannel).toBe("unknown");
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "channel_rule_conflict",
          severity: "warning",
          safeDetails: { matchType: "tag_exact" },
        },
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "unknown_channel",
          severity: "warning",
          safeDetails: { reason: "rule_conflict" },
        },
      ]);
    });

    it("counts a lead explicitly mapped to unknown as unknown channel", () => {
      const unknownContext = buildNormalizeLeadContext({
        channelRules: [
          buildChannelRule({
            id: "empty-source",
            priority: 1,
            matchType: "source_field_exact",
            matchValue: "Без значения",
            normalizedChannel: "unknown",
          }),
        ],
      });
      const result = normalizeLead(buildRawLead({ customSource: "Без значения" }), unknownContext);
      expect(result.lead?.channelRuleId).toBe("empty-source");
      expect(codes(result)).toEqual(["unknown_channel"]);
      expect(result.issues[0]?.safeDetails).toEqual({ reason: "mapped_to_unknown" });
    });
  });

  it.each([[undefined], [null], [0], [-5], [1.5], ["501"]])(
    "keeps a lead with missing responsible user %j and reports it",
    (responsibleUserId) => {
      const result = normalizeLead(buildRawLead({ responsibleUserId }), context);
      expect(result.lead?.currentResponsibleUserId).toBeNull();
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "missing_responsible",
          severity: "warning",
          safeDetails: {},
        },
      ]);
    },
  );

  it("blocks a current status missing from the pipeline metadata but keeps the lead", () => {
    const result = normalizeLead(buildRawLead({ statusId: 999 }), context);
    expect(result.status).toBe("normalized");
    expect(result.lead?.currentStatusId).toBe(999);
    expect(result.issues).toEqual([
      {
        accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
        amoLeadId: 101,
        code: "unknown_current_status",
        severity: "blocking",
        safeDetails: { statusId: 999 },
      },
    ]);
  });

  it("excludes a lead from another pipeline and keeps evidence", () => {
    expect(normalizeLead(buildRawLead({ pipelineId: 78 }), context)).toEqual({
      status: "excluded",
      lead: null,
      issues: [
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "out_of_scope_pipeline",
          severity: "warning",
          safeDetails: { pipelineId: 78 },
        },
      ],
    });
  });

  it("excludes an out-of-scope lead even when its timestamps are malformed", () => {
    const result = normalizeLead(
      buildRawLead({ pipelineId: 78, omit: ["created_at", "updated_at"] }),
      context,
    );
    expect(result.status).toBe("excluded");
    expect(codes(result)).toEqual(["out_of_scope_pipeline"]);
  });

  describe("rejections", () => {
    it.each([[undefined], [null], [0], [-1], [1.5], ["1789160400"], [253_402_290_000]])(
      "rejects created_at %j without guessing a date",
      (createdAt) => {
        expect(normalizeLead(buildRawLead({ createdAt }), context)).toEqual({
          status: "rejected",
          lead: null,
          issues: [
            {
              accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
              amoLeadId: 101,
              code: "invalid_created_at",
              severity: "blocking",
              safeDetails: {},
            },
          ],
        });
      },
    );

    it("rejects a missing updated_at", () => {
      const result = normalizeLead(buildRawLead({ omit: ["updated_at"] }), context);
      expect(result.status).toBe("rejected");
      expect(codes(result)).toEqual(["invalid_updated_at"]);
    });

    it.each([[undefined], [0], ["101"], [1.5], [Number.MAX_SAFE_INTEGER + 1]])(
      "rejects lead id %j with an account-level issue",
      (id) => {
        expect(normalizeLead(buildRawLead({ id }), context)).toEqual({
          status: "rejected",
          lead: null,
          issues: [
            {
              accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
              amoLeadId: null,
              code: "malformed_lead",
              severity: "blocking",
              safeDetails: { reasons: "invalid_id" },
            },
          ],
        });
      },
    );

    it("lists every malformed identity field in a fixed order", () => {
      const result = normalizeLead(
        buildRawLead({ pipelineId: null, statusId: "open", omit: ["account_id"] }),
        context,
      );
      expect(result.status).toBe("rejected");
      expect(result.issues).toEqual([
        {
          accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
          amoLeadId: 101,
          code: "malformed_lead",
          severity: "blocking",
          safeDetails: { reasons: "invalid_account,invalid_pipeline,invalid_status" },
        },
      ]);
    });

    it("rejects a lead from another amoCRM account", () => {
      const result = normalizeLead(buildRawLead({ accountId: 9002 }), context);
      expect(result.status).toBe("rejected");
      expect(codes(result)).toEqual(["account_mismatch"]);
      expect(result.issues[0]?.safeDetails).toEqual({});
    });

    it.each([[null], [undefined], ["lead"], [42], [[]], [[buildRawLead()]]])(
      "rejects non-object payload %j",
      (raw) => {
        const result = normalizeLead(raw, context);
        expect(result.status).toBe("rejected");
        expect(result.issues).toEqual([
          {
            accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
            amoLeadId: null,
            code: "malformed_lead",
            severity: "blocking",
            safeDetails: { reasons: "not_an_object" },
          },
        ]);
      },
    );

    it("collects every rejection issue sorted by code", () => {
      const result = normalizeLead(
        buildRawLead({ accountId: 9002, omit: ["created_at", "updated_at", "pipeline_id"] }),
        context,
      );
      expect(codes(result)).toEqual([
        "account_mismatch",
        "invalid_created_at",
        "invalid_updated_at",
        "malformed_lead",
      ]);
    });
  });

  it("orders issues by code independent of detection order", () => {
    const result = normalizeLead(
      buildRawLead({
        statusId: 999,
        responsibleUserId: null,
        customSource: "Неизвестно",
        price: "abc",
      }),
      context,
    );
    expect(codes(result)).toEqual([
      "invalid_price",
      "missing_responsible",
      "unknown_channel",
      "unknown_current_status",
    ]);
  });

  it("returns an equal result for equal input and does not mutate it", () => {
    const raw = deepFreeze(buildRawLead({ tags: ["vip"], name: "+7 000 111-22-33" }));
    const frozenContext = deepFreeze(buildNormalizeLeadContext());
    const first = normalizeLead(raw, frozenContext);
    const second = normalizeLead(structuredClone(raw), buildNormalizeLeadContext());
    expect(second).toEqual(first);
  });

  it("does not depend on the order of channel rules or status IDs", () => {
    const reversed = buildNormalizeLeadContext({
      channelRules: [...context.channelRules].reverse(),
      pipelineStatusIds: [...context.pipelineStatusIds].reverse(),
    });
    const raw = buildRawLead({ customSource: "Tilda" });
    expect(normalizeLead(raw, reversed)).toEqual(normalizeLead(raw, context));
  });

  describe("context validation", () => {
    it.each([
      ["accountId", { accountId: 0 }],
      ["accountId", { accountId: 1.5 }],
      ["normalizedAt", { normalizedAt: "yesterday" }],
      ["normalizedAt", { normalizedAt: "2026-09-17T12:00:00" }],
      ["config", { config: { id: "", pipelineId: 77, wonStatusId: 772, sourceFieldId: null } }],
      ["config", { config: { id: SYNTHETIC_CONFIG_ID, pipelineId: -1, wonStatusId: 772, sourceFieldId: null } }],
      ["config", { config: { id: SYNTHETIC_CONFIG_ID, pipelineId: 77, wonStatusId: 772, sourceFieldId: 0 } }],
      ["pipelineStatusIds", { pipelineStatusIds: [0] }],
      ["channelRules", { channelRules: [{ id: "x", priority: 1, matchType: "name_contains", matchValue: "a", normalizedChannel: "site", isActive: true }] }],
      ["channelRules", { channelRules: [{ id: "x", priority: 1, matchType: "tag_exact", matchValue: "a", normalizedChannel: "vk", isActive: true }] }],
    ])("throws a validation error for an invalid %s", (_field, override) => {
      const invalid = { ...buildNormalizeLeadContext(), ...override } as unknown as typeof context;
      expect(() => normalizeLead(buildRawLead(), invalid)).toThrow(AppError);
    });
  });

  describe("properties", () => {
    it("never throws on arbitrary JSON payloads", () => {
      fc.assert(
        fc.property(fc.jsonValue(), (raw) => {
          const result = normalizeLead(raw, context);
          expect(["normalized", "excluded", "rejected"]).toContain(result.status);
          expect(result.issues.length).toBeGreaterThan(0);
        }),
      );
    });

    it("never throws when fields of a lead are replaced by arbitrary values", () => {
      const keys = ["id", "account_id", "name", "price", "status_id", "pipeline_id", "responsible_user_id", "created_at", "updated_at", "custom_fields_values", "_embedded"] as const;
      fc.assert(
        fc.property(fc.constantFrom(...keys), fc.anything(), (key, value) => {
          const raw = { ...buildRawLead(), [key]: value };
          const first = normalizeLead(raw, context);
          expect(normalizeLead(raw, context)).toEqual(first);
          if (first.lead) expect(first.lead.priceRub === null || /^\d+\.\d{2}$/.test(first.lead.priceRub)).toBe(true);
        }),
      );
    });

    it("keeps arbitrary Unicode names stable and never displays phone-like text", () => {
      const phoneish = fc.stringMatching(/^\+?[78]?[ (]?\d{3}[) -]?\d{3}[ -]?\d{2}[ -]?\d{2}$/);
      const nameArbitrary = fc
        .tuple(fc.string({ unit: "grapheme", maxLength: 24 }), fc.option(phoneish), fc.string({ unit: "grapheme", maxLength: 24 }))
        .map(([before, phone, after]) => `${before}${phone ?? ""}${after}`);
      fc.assert(
        fc.property(nameArbitrary, (name) => {
          const result = normalizeLead(buildRawLead({ name }), context);
          expect(result.status).toBe("normalized");
          expect(result.issues).toEqual([]);
          const lead = result.lead!;
          expect(lead.name.length).toBeGreaterThan(0);
          expect([name, "Сделка #101"]).toContain(lead.name);
          expect(normalizeLead(buildRawLead({ name }), context)).toEqual(result);
          const digitRun = /\p{Nd}(?:[\s().+-]*\p{Nd}){9}/u;
          expect(digitRun.test(lead.displayName)).toBe(false);
        }),
      );
    });

    it("derives created date from created_at for every valid timestamp", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 253_402_289_999 }), (createdAt) => {
          const lead = normalizeLead(buildRawLead({ createdAt }), context).lead!;
          expect(lead.createdAt).toBe(new Date(createdAt * 1_000).toISOString());
          expect(lead.createdDate).toBe(toMoscowDate(lead.createdAt));
        }),
      );
    });
  });
});
