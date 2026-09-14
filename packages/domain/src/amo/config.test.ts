import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import {
  amoConfigDiscoverySchema,
  INITIAL_CHANNEL_RULES,
  validateChannelRules,
  validatePipelineConfig,
  type AmoConfigDiscovery,
  type ChannelRuleCandidate,
  type PipelineConfigCandidate,
} from "./config.js";

const candidate: PipelineConfigCandidate = {
  pipelineId: 10_243_278,
  applicationStatusId: 11,
  wonStatusId: 99,
  channelFieldId: 77,
};

function fixtureDiscovery(
  overrides: Partial<AmoConfigDiscovery> = {},
): AmoConfigDiscovery {
  return {
    pipelines: [
      {
        id: 10_243_278,
        name: "РЕАЛ ДВА",
        statuses: [
          { id: 11, name: "Завершение (самовывоз или доставка)" },
          { id: 12, name: "В работе" },
          { id: 99, name: "Успешно реализовано" },
        ],
      },
    ],
    leadCustomFields: [{ id: 77, name: "Источник сделки" }],
    users: [{ id: 501, name: "Synthetic User" }],
    ...overrides,
  };
}

describe("validatePipelineConfig", () => {
  it("accepts only live-confirmed application and won statuses in the selected pipeline", () => {
    const discovery = fixtureDiscovery();

    expect(validatePipelineConfig(candidate, discovery)).toMatchObject({
      valid: true,
      resolved: {
        pipelineId: 10_243_278,
        pipelineName: "РЕАЛ ДВА",
        applicationStatusId: 11,
        applicationStatusName: "Завершение (самовывоз или доставка)",
        wonStatusId: 99,
        wonStatusName: "Успешно реализовано",
        channelFieldId: 77,
      },
    });
    expect(
      validatePipelineConfig(
        { ...candidate, applicationStatusId: 404 },
        discovery,
      ),
    ).toMatchObject({ valid: false, code: "E_CONFIG_INCOMPLETE" });
  });

  it("rejects screenshot-derived candidate IDs until API discovery confirms the exact names", () => {
    const discovery = fixtureDiscovery({
      pipelines: [
        {
          id: 10_243_278,
          name: "РЕАЛ ДВА",
          statuses: [
            { id: 11, name: "Заявка" },
            { id: 99, name: "Успешно реализовано" },
          ],
        },
      ],
    });

    expect(validatePipelineConfig(candidate, discovery)).toMatchObject({
      valid: false,
      code: "E_CONFIG_INCOMPLETE",
    });
  });

  it("rejects the same status for application and won even when live discovery contains it", () => {
    expect(
      validatePipelineConfig(
        { ...candidate, wonStatusId: candidate.applicationStatusId },
        fixtureDiscovery(),
      ),
    ).toMatchObject({ valid: false, code: "E_CONFIG_INCOMPLETE" });
  });

  it("returns one deterministic checksum for equivalent metadata regardless of source ordering", () => {
    const ordered = validatePipelineConfig(candidate, fixtureDiscovery());
    const reordered = validatePipelineConfig(
      candidate,
      fixtureDiscovery({
        pipelines: [
          {
            id: 10_243_278,
            name: "РЕАЛ ДВА",
            statuses: [
              { id: 99, name: "Успешно реализовано" },
              { id: 11, name: "Завершение (самовывоз или доставка)" },
              { id: 12, name: "В работе" },
            ],
          },
        ],
        leadCustomFields: [{ id: 77, name: "Источник сделки" }],
        users: [{ id: 501, name: "Synthetic User" }],
      }),
    );

    expect(ordered).toMatchObject({ valid: true });
    expect(reordered).toMatchObject({ valid: true });
    if (!ordered.valid || !reordered.valid) throw new Error("fixture must validate");
    expect(reordered.metadataChecksum).toBe(ordered.metadataChecksum);
  });

  it("reports same-ID name drift as a warning only after the IDs were previously confirmed", () => {
    const original = validatePipelineConfig(candidate, fixtureDiscovery());
    if (!original.valid) throw new Error("fixture must validate");
    const renamedDiscovery = fixtureDiscovery({
      pipelines: [
        {
          id: candidate.pipelineId,
          name: "РЕАЛ ДВА — новое имя",
          statuses: [
            { id: candidate.applicationStatusId, name: "Завершение — новое имя" },
            { id: candidate.wonStatusId, name: "Продажа — новое имя" },
          ],
        },
      ],
    });

    expect(validatePipelineConfig(candidate, renamedDiscovery)).toMatchObject({
      valid: false,
      code: "E_CONFIG_INCOMPLETE",
    });
    expect(
      validatePipelineConfig(candidate, renamedDiscovery, {
        activeConfig: original.resolved,
      }),
    ).toMatchObject({
      valid: true,
      requiresNameConfirmation: true,
      warnings: [
        "pipeline_name_changed",
        "application_status_name_changed",
        "won_status_name_changed",
      ],
      resolved: {
        pipelineName: "РЕАЛ ДВА — новое имя",
        applicationStatusName: "Завершение — новое имя",
        wonStatusName: "Продажа — новое имя",
      },
    });
  });

  it("warns when previously confirmed renamed IDs return to the canonical names", () => {
    const canonical = validatePipelineConfig(candidate, fixtureDiscovery());
    if (!canonical.valid) throw new Error("fixture must validate");
    const renamed = validatePipelineConfig(
      candidate,
      fixtureDiscovery({
        pipelines: [
          {
            id: candidate.pipelineId,
            name: "РЕАЛ ДВА — новое имя",
            statuses: [
              { id: candidate.applicationStatusId, name: "Завершение — новое имя" },
              { id: candidate.wonStatusId, name: "Продажа — новое имя" },
            ],
          },
        ],
      }),
      { activeConfig: canonical.resolved },
    );
    if (!renamed.valid) throw new Error("same-ID rename must validate with warnings");

    expect(
      validatePipelineConfig(candidate, fixtureDiscovery(), {
        activeConfig: renamed.resolved,
      }),
    ).toMatchObject({
      valid: true,
      requiresNameConfirmation: true,
      warnings: [
        "pipeline_name_changed",
        "application_status_name_changed",
        "won_status_name_changed",
      ],
      resolved: {
        pipelineName: "РЕАЛ ДВА",
        applicationStatusName: "Завершение (самовывоз или доставка)",
        wonStatusName: "Успешно реализовано",
      },
    });
  });

  it.each([
    [
      "pipeline",
      fixtureDiscovery({
        pipelines: [
          ...fixtureDiscovery().pipelines,
          { id: 10_243_278, name: "Conflicting duplicate", statuses: [] },
        ],
      }),
    ],
    [
      "status",
      fixtureDiscovery({
        pipelines: [
          {
            ...fixtureDiscovery().pipelines[0]!,
            statuses: [
              ...fixtureDiscovery().pipelines[0]!.statuses,
              { id: 11, name: "Conflicting duplicate" },
            ],
          },
        ],
      }),
    ],
    [
      "custom field",
      fixtureDiscovery({
        leadCustomFields: [
          { id: 77, name: "Источник сделки" },
          { id: 77, name: "Источник сделки" },
        ],
      }),
    ],
  ])("rejects duplicate %s IDs before response order can affect selection", (_label, discovery) => {
    expect(() => amoConfigDiscoverySchema.parse(discovery)).toThrow();
    expect(() => validatePipelineConfig(candidate, discovery)).toThrow();
  });
});

describe("validateChannelRules", () => {
  it("ships exact mappings for every catalogued non-unknown source variant", () => {
    expect(() => validateChannelRules(INITIAL_CHANNEL_RULES)).not.toThrow();

    expect(INITIAL_CHANNEL_RULES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchValue: "Звонок", normalizedChannel: "phone_uis" }),
        expect.objectContaining({ matchValue: "WhatsApp", normalizedChannel: "whatsapp" }),
        expect.objectContaining({ matchValue: "Авито", normalizedChannel: "avito" }),
        expect.objectContaining({ matchValue: "Instagram", normalizedChannel: "instagram" }),
        expect.objectContaining({ matchValue: "tilda", normalizedChannel: "site" }),
        expect.objectContaining({ matchValue: "Telegram", normalizedChannel: "telegram" }),
        expect.objectContaining({ matchValue: "MAX", normalizedChannel: "max" }),
      ]),
    );
  });

  it("rejects duplicate exact rules and duplicate priorities instead of inferring a winner", () => {
    const duplicateValue: readonly ChannelRuleCandidate[] = [
      ...INITIAL_CHANNEL_RULES,
      {
        ...INITIAL_CHANNEL_RULES[0]!,
        priority: 999,
        normalizedChannel: "unknown",
      },
    ];
    const duplicatePriority: readonly ChannelRuleCandidate[] = [
      ...INITIAL_CHANNEL_RULES,
      {
        ...INITIAL_CHANNEL_RULES[0]!,
        matchValue: "Synthetic duplicate priority",
      },
    ];

    expect(() => validateChannelRules(duplicateValue)).toThrowError(AppError);
    expect(() => validateChannelRules(duplicatePriority)).toThrowError(AppError);
  });

  it("rejects priorities that place tags or integration sources before source-field rules", () => {
    const wrongSourceOrder: readonly ChannelRuleCandidate[] = [
      ...INITIAL_CHANNEL_RULES.map((rule) => ({
        ...rule,
        priority: rule.priority + 2,
      })),
      {
        priority: 1,
        matchType: "tag_exact",
        matchValue: "confirmed-tag",
        normalizedChannel: "site",
      },
      {
        priority: 2,
        matchType: "integration_source_exact",
        matchValue: "confirmed-integration",
        normalizedChannel: "telegram",
      },
    ];

    expect(() => validateChannelRules(wrongSourceOrder)).toThrowError(AppError);
  });

  it("does not treat tag rules as the required exact source-field catalog", () => {
    const catalogAsTags: readonly ChannelRuleCandidate[] = INITIAL_CHANNEL_RULES.map(
      (rule) => ({ ...rule, matchType: "tag_exact" }),
    );

    expect(() => validateChannelRules(catalogAsTags)).toThrowError(AppError);
  });
});
