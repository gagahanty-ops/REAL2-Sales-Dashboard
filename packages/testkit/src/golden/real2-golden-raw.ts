import { goldenLeadFacts } from "./real2-golden.js";

/**
 * Raw amoCRM payloads that normalize into `goldenLeadFacts`. Every value is
 * fictional. The pair is deliberate: the raw fixture proves that the metric
 * expectations survive the whole pipeline, not just the metric engine.
 */

export const GOLDEN_ACCOUNT_ID = 9001;
export const GOLDEN_SUBDOMAIN = "555151";
export const GOLDEN_PIPELINE_ID = 77;
export const GOLDEN_OPEN_STATUS_ID = 770;
export const GOLDEN_APPLICATION_STATUS_ID = 771;
export const GOLDEN_WON_STATUS_ID = 772;
export const GOLDEN_SOURCE_FIELD_ID = 3001;

/** Source-field values confirmed by METRICS_CATALOG section 7. */
export const GOLDEN_CHANNEL_RULES: readonly Readonly<{
  priority: number;
  matchValue: string;
  normalizedChannel: string;
}>[] = [
  { priority: 1, matchValue: "Звонок", normalizedChannel: "phone_uis" },
  { priority: 2, matchValue: "WhatsApp", normalizedChannel: "whatsapp" },
  { priority: 3, matchValue: "Avito", normalizedChannel: "avito" },
  { priority: 4, matchValue: "Instagram", normalizedChannel: "instagram" },
  { priority: 5, matchValue: "Сайт Real2 - диалоговое окно", normalizedChannel: "site" },
  { priority: 6, matchValue: "Telegram", normalizedChannel: "telegram" },
  { priority: 7, matchValue: "MAX", normalizedChannel: "max" },
];

const CHANNEL_SOURCE_VALUE: Readonly<Record<string, string | null>> = {
  phone_uis: "Звонок",
  whatsapp: "WhatsApp",
  avito: "Avito",
  instagram: "Instagram",
  site: "Сайт Real2 - диалоговое окно",
  telegram: "Telegram",
  max: "MAX",
  /** Scenario 7: a filled but unmapped value normalizes to `unknown`. */
  unknown: "Партнёрская рассылка",
};

export type GoldenRawObject = Readonly<{
  entityType: "lead" | "status" | "user";
  externalId: number;
  sourceUpdatedAt: Date | null;
  payload: Record<string, unknown>;
}>;

export type GoldenRawEvent = Readonly<{
  amoEventId: string;
  amoLeadId: number;
  eventType: string;
  eventAt: string;
  payload: Record<string, unknown>;
}>;

const MANAGER_NAMES: Readonly<Record<number, string>> = {
  7: "Менеджер Алиса",
  8: "Менеджер Борис",
  9: "Менеджер Вера",
};

/** Moscow noon of a calendar day, as amoCRM's unix `created_at`. */
function unixAtMoscowNoon(date: string): number {
  return Date.parse(`${date}T09:00:00.000Z`) / 1_000;
}

const NEAR_MIDNIGHT_UNIX: Readonly<Record<number, number>> = {
  1010: Date.UTC(2026, 8, 8, 20, 59, 59) / 1_000,
  1011: Date.UTC(2026, 8, 8, 21, 0, 0) / 1_000,
};

/** Current status of each lead in the newest snapshot of the golden run. */
const CURRENT_STATUS: Readonly<Record<number, number>> = {
  1001: GOLDEN_OPEN_STATUS_ID,
  1002: GOLDEN_APPLICATION_STATUS_ID,
  1003: GOLDEN_WON_STATUS_ID,
  1004: GOLDEN_APPLICATION_STATUS_ID,
  1005: GOLDEN_OPEN_STATUS_ID,
  1006: GOLDEN_APPLICATION_STATUS_ID,
  1007: GOLDEN_OPEN_STATUS_ID,
  1008: GOLDEN_WON_STATUS_ID,
  1009: GOLDEN_WON_STATUS_ID,
  1010: GOLDEN_OPEN_STATUS_ID,
  1011: GOLDEN_OPEN_STATUS_ID,
};

const uniqueFacts = goldenLeadFacts.filter(
  (fact, index) =>
    goldenLeadFacts.findIndex((other) => other.amoLeadId === fact.amoLeadId) === index,
);

export const goldenRawStatuses: readonly GoldenRawObject[] = [
  { statusId: GOLDEN_OPEN_STATUS_ID, name: "Первичный контакт", sort: 10 },
  { statusId: GOLDEN_APPLICATION_STATUS_ID, name: "Заявка", sort: 20 },
  { statusId: GOLDEN_WON_STATUS_ID, name: "Успешно реализовано", sort: 30 },
].map((status) => ({
  entityType: "status" as const,
  externalId: status.statusId,
  sourceUpdatedAt: null,
  payload: {
    id: status.statusId,
    name: status.name,
    sort: status.sort,
    pipeline_id: GOLDEN_PIPELINE_ID,
    account_id: GOLDEN_ACCOUNT_ID,
  },
}));

export const goldenRawUsers: readonly GoldenRawObject[] = Object.entries(MANAGER_NAMES)
  .map(([id, name]) => ({
    entityType: "user" as const,
    externalId: Number(id),
    sourceUpdatedAt: null,
    payload: { id: Number(id), name, rights: { is_active: true } },
  }));

export const goldenRawLeads: readonly GoldenRawObject[] = uniqueFacts.map((fact) => {
  const createdAt = NEAR_MIDNIGHT_UNIX[fact.amoLeadId]
    ?? unixAtMoscowNoon(fact.createdDate);
  const sourceValue = CHANNEL_SOURCE_VALUE[fact.channel] ?? null;
  return {
    entityType: "lead" as const,
    externalId: fact.amoLeadId,
    sourceUpdatedAt: new Date((createdAt + 3_600) * 1_000),
    payload: {
      id: fact.amoLeadId,
      account_id: GOLDEN_ACCOUNT_ID,
      name: `Синтетическая сделка ${fact.amoLeadId}`,
      price: fact.priceRub === null ? null : Number(fact.priceRub.split(".")[0]),
      status_id: CURRENT_STATUS[fact.amoLeadId],
      pipeline_id: GOLDEN_PIPELINE_ID,
      responsible_user_id: fact.managerId,
      created_at: createdAt,
      updated_at: createdAt + 3_600,
      custom_fields_values: sourceValue === null
        ? null
        : [
            {
              field_id: GOLDEN_SOURCE_FIELD_ID,
              field_name: "Источник сделки",
              values: [{ value: sourceValue }],
            },
          ],
      _embedded: { tags: [] },
    },
  };
});

function stageEvent(
  amoLeadId: number,
  suffix: string,
  occurredAt: string,
  toStatusId: number,
  fromStatusId: number | null,
): GoldenRawEvent {
  return {
    amoEventId: `golden-${amoLeadId}-${suffix}`,
    amoLeadId,
    eventType: "lead_status_changed",
    eventAt: occurredAt,
    payload: {
      entity_type: "lead",
      entity_id: amoLeadId,
      value_before: fromStatusId === null ? [] : [{ lead_status: { id: fromStatusId } }],
      value_after: [{ lead_status: { id: toStatusId } }],
    },
  };
}

const extraEvents: readonly GoldenRawEvent[] = [
  // Scenario 4: re-entering the application stage must not add a milestone.
  stageEvent(
    1004,
    "reentry-open",
    "2026-09-08T08:00:00.000Z",
    GOLDEN_OPEN_STATUS_ID,
    GOLDEN_APPLICATION_STATUS_ID,
  ),
  stageEvent(
    1004,
    "reentry-application",
    "2026-09-09T08:00:00.000Z",
    GOLDEN_APPLICATION_STATUS_ID,
    GOLDEN_OPEN_STATUS_ID,
  ),
  // Scenario 5: the win is returned to an open status.
  stageEvent(
    1005,
    "returned",
    "2026-09-09T08:00:00.000Z",
    GOLDEN_OPEN_STATUS_ID,
    GOLDEN_WON_STATUS_ID,
  ),
];

export const goldenRawEvents: readonly GoldenRawEvent[] = [
  ...uniqueFacts.flatMap((fact) => {
    const events: GoldenRawEvent[] = [];
    if (fact.applicationAt !== null) {
      events.push(stageEvent(
        fact.amoLeadId,
        "application",
        fact.applicationAt,
        GOLDEN_APPLICATION_STATUS_ID,
        GOLDEN_OPEN_STATUS_ID,
      ));
    }
    if (fact.wonAt !== null) {
      events.push(stageEvent(
        fact.amoLeadId,
        "won",
        fact.wonAt,
        GOLDEN_WON_STATUS_ID,
        GOLDEN_APPLICATION_STATUS_ID,
      ));
    }
    return events;
  }),
  ...extraEvents,
];

/**
 * Scenario 9: the same event delivered twice. The pair is returned separately
 * so a test can append it and prove that repeated delivery changes no total.
 */
export const goldenRepeatedEvents: readonly GoldenRawEvent[] = goldenRawEvents.filter(
  (event) => event.amoLeadId === 1009,
);
