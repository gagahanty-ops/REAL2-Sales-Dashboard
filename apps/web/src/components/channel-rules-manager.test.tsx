import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  buildChannelActivationPayload,
  ChannelRulesManager,
  validateChannelRuleEdits,
  type ChannelRuleEdit,
} from "./channel-rules-manager";

const candidate = {
  pipelineId: 10_243_278,
  applicationStatusId: 11,
  wonStatusId: 99,
  channelFieldId: 77,
};

const rules: readonly ChannelRuleEdit[] = [
  {
    priority: 1,
    matchType: "source_field_exact",
    matchValue: "Звонок",
    normalizedChannel: "phone_uis",
  },
  {
    priority: 2,
    matchType: "tag_exact",
    matchValue: "Synthetic tag",
    normalizedChannel: "telegram",
  },
  {
    priority: 3,
    matchType: "integration_source_exact",
    matchValue: "Synthetic integration",
    normalizedChannel: "whatsapp",
  },
];

describe("ChannelRulesManager", () => {
  it("renders editable exact mapping controls for all supported evidence sources", () => {
    const html = renderToStaticMarkup(
      <ChannelRulesManager
        initialConfig={{
          configId: "10000000-0000-4000-8000-000000000001",
          version: 4,
          candidate,
          channelRules: rules,
        }}
      />,
    );

    expect(html).toContain("source_field_exact");
    expect(html).toContain("tag_exact");
    expect(html).toContain("integration_source_exact");
    expect(html).toContain("Synthetic tag");
    expect(html).toContain("Добавить правило");
    expect(html).toContain("Проверить и активировать");
  });

  it("builds an activation payload from edited rules and binds it to the expected active config", () => {
    expect(
      buildChannelActivationPayload({
        configId: "10000000-0000-4000-8000-000000000001",
        candidate,
        channelRules: rules,
        metadataChecksum: "a".repeat(64),
        confirmNameChanges: true,
      }),
    ).toEqual({
      candidate,
      channelRules: rules,
      metadataChecksum: "a".repeat(64),
      expectedActiveConfigId: "10000000-0000-4000-8000-000000000001",
      confirmNameChanges: true,
    });
  });

  it("rejects duplicate exact keys, duplicate priorities, and cross-source priority inversions", () => {
    expect(
      validateChannelRuleEdits([
        ...rules,
        { ...rules[0]!, priority: 4, normalizedChannel: "unknown" },
      ]),
    ).toMatch(/значение/i);
    expect(
      validateChannelRuleEdits([
        ...rules,
        { ...rules[0]!, matchValue: "Other" },
      ]),
    ).toMatch(/приоритет/i);
    expect(
      validateChannelRuleEdits([
        { ...rules[0]!, priority: 2 },
        { ...rules[1]!, priority: 1 },
        rules[2]!,
      ]),
    ).toMatch(/порядок/i);
  });
});
