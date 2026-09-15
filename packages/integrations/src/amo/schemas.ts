import { z } from "zod";

const positiveId = z.number().int().positive();
const unixTimestamp = z.number().int().nonnegative();

const amoLinkSchema = z.looseObject({
  href: z.string().min(1),
});

const amoPageLinksSchema = z.looseObject({
  self: amoLinkSchema.optional(),
  next: amoLinkSchema.optional(),
});

const amoCustomFieldValueSchema = z.looseObject({
  field_id: positiveId,
  values: z.array(
    z.looseObject({
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ),
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
  custom_fields_values: z.array(amoCustomFieldValueSchema).nullable().optional(),
});

export const amoEventSchema = z.looseObject({
  id: positiveId,
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
