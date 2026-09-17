import type {
  ChannelMatchType,
  ChannelRule,
  NormalizedChannel,
  NormalizeLeadContext,
} from "@real2/domain";

export const SYNTHETIC_LEAD_ACCOUNT_ID = 9001;
export const SYNTHETIC_PIPELINE_ID = 77;
export const SYNTHETIC_OPEN_STATUS_ID = 770;
export const SYNTHETIC_APPLICATION_STATUS_ID = 771;
export const SYNTHETIC_WON_STATUS_ID = 772;
export const SYNTHETIC_SOURCE_FIELD_ID = 3001;
export const SYNTHETIC_CONFIG_ID = "00000000-0000-4000-8000-000000000077";

const DEFAULT_CREATED_AT = Date.UTC(2026, 8, 5, 9, 0, 0) / 1_000;
const DEFAULT_UPDATED_AT = Date.UTC(2026, 8, 10, 10, 0, 0) / 1_000;

type RawLeadKey =
  | "id"
  | "account_id"
  | "name"
  | "price"
  | "status_id"
  | "pipeline_id"
  | "responsible_user_id"
  | "created_at"
  | "updated_at"
  | "custom_fields_values"
  | "_embedded";

export type RawLeadOverrides = Readonly<{
  id?: unknown;
  accountId?: unknown;
  name?: unknown;
  price?: unknown;
  statusId?: unknown;
  pipelineId?: unknown;
  responsibleUserId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  /** Value of the confirmed source field; `null` leaves the field out. */
  customSource?: string | null;
  tags?: readonly string[];
  /** amoCRM `_embedded.source.name`; `null` leaves it out. */
  integrationSource?: string | null;
  /** Top-level keys removed after the payload is built. */
  omit?: readonly RawLeadKey[];
}>;

/**
 * Builds a synthetic amoCRM API v4 lead payload. Every value is fictional and
 * contains no personal data.
 */
export function buildRawLead(
  overrides: RawLeadOverrides = {},
): Record<string, unknown> {
  const customSource =
    overrides.customSource === undefined ? "Звонок" : overrides.customSource;
  const integrationSource = overrides.integrationSource ?? null;
  const embedded: Record<string, unknown> = {
    tags: (overrides.tags ?? []).map((name, index) => ({
      id: 4_000 + index,
      name,
      color: null,
    })),
  };
  if (integrationSource !== null) {
    embedded.source = { id: 5_001, name: integrationSource };
  }

  const payload: Record<string, unknown> = {
    id: "id" in overrides ? overrides.id : 101,
    account_id:
      "accountId" in overrides ? overrides.accountId : SYNTHETIC_LEAD_ACCOUNT_ID,
    name: "name" in overrides ? overrides.name : "Синтетическая сделка",
    price: "price" in overrides ? overrides.price : 12_500,
    status_id:
      "statusId" in overrides ? overrides.statusId : SYNTHETIC_OPEN_STATUS_ID,
    pipeline_id:
      "pipelineId" in overrides ? overrides.pipelineId : SYNTHETIC_PIPELINE_ID,
    responsible_user_id:
      "responsibleUserId" in overrides ? overrides.responsibleUserId : 501,
    created_at:
      "createdAt" in overrides ? overrides.createdAt : DEFAULT_CREATED_AT,
    updated_at:
      "updatedAt" in overrides ? overrides.updatedAt : DEFAULT_UPDATED_AT,
    custom_fields_values:
      customSource === null
        ? null
        : [
            {
              field_id: SYNTHETIC_SOURCE_FIELD_ID,
              field_name: "Источник сделки",
              values: [{ value: customSource }],
            },
          ],
    _embedded: embedded,
  };

  for (const key of overrides.omit ?? []) {
    delete payload[key];
  }
  return payload;
}

export function buildChannelRule(
  rule: Readonly<{
    id: string;
    priority: number;
    matchType: ChannelMatchType;
    matchValue: string;
    normalizedChannel: NormalizedChannel;
    isActive?: boolean;
  }>,
): ChannelRule {
  return { isActive: true, ...rule };
}

/** The approved initial source-field mapping from METRICS_CATALOG section 7. */
export const SYNTHETIC_INITIAL_RULES: readonly ChannelRule[] = [
  ["Звонок", "phone_uis"],
  ["UIS", "phone_uis"],
  ["uis", "phone_uis"],
  ["WhatsApp", "whatsapp"],
  ["Whatsapp", "whatsapp"],
  ["Avito", "avito"],
  ["Авито", "avito"],
  ["Instagram", "instagram"],
  ["Сайт Real2 - диалоговое окно", "site"],
  ["Tilda", "site"],
  ["tilda", "site"],
  ["сайт", "site"],
  ["Telegram", "telegram"],
  ["MAX", "max"],
].map(([matchValue, normalizedChannel], index) =>
  buildChannelRule({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    priority: index + 1,
    matchType: "source_field_exact",
    matchValue: matchValue!,
    normalizedChannel: normalizedChannel as NormalizedChannel,
  }),
);

export function buildNormalizeLeadContext(
  overrides: Partial<NormalizeLeadContext> = {},
): NormalizeLeadContext {
  return {
    accountId: SYNTHETIC_LEAD_ACCOUNT_ID,
    config: {
      id: SYNTHETIC_CONFIG_ID,
      pipelineId: SYNTHETIC_PIPELINE_ID,
      wonStatusId: SYNTHETIC_WON_STATUS_ID,
      sourceFieldId: SYNTHETIC_SOURCE_FIELD_ID,
    },
    channelRules: SYNTHETIC_INITIAL_RULES,
    pipelineStatusIds: [
      SYNTHETIC_OPEN_STATUS_ID,
      SYNTHETIC_APPLICATION_STATUS_ID,
      SYNTHETIC_WON_STATUS_ID,
    ],
    normalizedAt: "2026-09-17T12:00:00.000Z",
    ...overrides,
  };
}
