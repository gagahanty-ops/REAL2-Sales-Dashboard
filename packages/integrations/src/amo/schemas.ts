import { z } from "zod";

const positiveId = z.number().int().positive();
const unixTimestamp = z.number().int().nonnegative();
const amoEventId = z.string().min(1).max(128);

const MAX_CUSTOM_FIELD_DEPTH = 8;
const MAX_CUSTOM_FIELD_ITEMS = 1_000;
const MAX_CUSTOM_FIELD_KEYS = 128;
const MAX_CUSTOM_FIELD_STRING_LENGTH = 65_536;

function isBoundedJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_CUSTOM_FIELD_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    return value.length <= MAX_CUSTOM_FIELD_STRING_LENGTH;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_CUSTOM_FIELD_ITEMS &&
      value.every((item) => isBoundedJson(item, depth + 1))
    );
  }
  if (typeof value !== "object") return false;

  const entries = Object.entries(value);
  return (
    entries.length <= MAX_CUSTOM_FIELD_KEYS &&
    entries.every(
      ([key, item]) =>
        key.length <= 256 && isBoundedJson(item, depth + 1),
    )
  );
}

const boundedJsonSchema = z.unknown().refine(isBoundedJson);

const amoLinkSchema = z.looseObject({
  href: z.string().min(1),
});

const amoPageLinksSchema = z.looseObject({
  self: amoLinkSchema.optional(),
  next: amoLinkSchema.optional(),
});

const amoCustomFieldValueItemSchema = z
  .object({
    value: boundedJsonSchema.optional(),
    enum_id: positiveId.optional(),
    enum_code: z.string().max(200).optional(),
    catalog_id: positiveId.optional(),
    catalog_element_id: positiveId.optional(),
  })
  .catchall(boundedJsonSchema)
  .refine((item) => {
    const keys = Object.keys(item);
    return keys.length > 0 && keys.length <= MAX_CUSTOM_FIELD_KEYS;
  });

const amoCustomFieldValueSchema = z.looseObject({
  field_id: positiveId,
  values: z.array(amoCustomFieldValueItemSchema).max(MAX_CUSTOM_FIELD_ITEMS),
});

export const amoAccountResponseSchema = z.looseObject({
  id: positiveId,
  subdomain: z.string().min(1),
});

export const amoPipelineSchema = z.looseObject({
  id: positiveId,
  name: z.string().min(1),
  account_id: positiveId.optional(),
});

export const amoStatusSchema = z.looseObject({
  id: positiveId,
  name: z.string().min(1),
  pipeline_id: positiveId,
  account_id: positiveId.optional(),
});

export const amoUserSchema = z.looseObject({
  id: positiveId,
  name: z.string().min(1),
});

export const amoLeadSchema = z.looseObject({
  id: positiveId,
  account_id: positiveId,
  created_at: unixTimestamp,
  updated_at: unixTimestamp,
  status_id: positiveId.optional(),
  pipeline_id: positiveId.optional(),
  responsible_user_id: positiveId.optional(),
  custom_fields_values: z
    .array(amoCustomFieldValueSchema)
    .max(MAX_CUSTOM_FIELD_ITEMS)
    .nullable()
    .optional(),
});

export const amoEventSchema = z.looseObject({
  id: amoEventId,
  type: z.string().min(1),
  entity_id: positiveId,
  entity_type: z.string().min(1),
  created_at: unixTimestamp,
  account_id: positiveId,
});

function pageSchema<TKey extends string, TItem extends z.ZodType>(
  key: TKey,
  item: TItem,
) {
  return z.looseObject({
    _page: z.number().int().positive().optional(),
    _links: amoPageLinksSchema.optional(),
    _embedded: z.object({ [key]: z.array(item) }) as z.ZodObject<
      Record<TKey, z.ZodArray<TItem>>
    >,
  });
}

export const amoPipelinesResponseSchema = pageSchema(
  "pipelines",
  amoPipelineSchema,
);
export const amoStatusesResponseSchema = pageSchema("statuses", amoStatusSchema);
export const amoUsersResponseSchema = pageSchema("users", amoUserSchema);
export const amoLeadsResponseSchema = pageSchema("leads", amoLeadSchema);
export const amoEventsResponseSchema = pageSchema("events", amoEventSchema);

export type AmoAccountResponse = z.infer<typeof amoAccountResponseSchema>;
export type AmoPipeline = z.infer<typeof amoPipelineSchema>;
export type AmoStatus = z.infer<typeof amoStatusSchema>;
export type AmoUser = z.infer<typeof amoUserSchema>;
export type AmoLead = z.infer<typeof amoLeadSchema>;
export type AmoEvent = z.infer<typeof amoEventSchema>;
export type AmoPipelinesResponse = z.infer<typeof amoPipelinesResponseSchema>;
export type AmoStatusesResponse = z.infer<typeof amoStatusesResponseSchema>;
export type AmoUsersResponse = z.infer<typeof amoUsersResponseSchema>;
export type AmoLeadsResponse = z.infer<typeof amoLeadsResponseSchema>;
export type AmoEventsResponse = z.infer<typeof amoEventsResponseSchema>;
