import { describe, expect, it } from "vitest";

import {
  amoEventsResponseSchema,
  amoEventSchema,
  amoLeadsResponseSchema,
  amoUsersResponseSchema,
} from "./schemas";

describe("amoCRM synchronization response schemas", () => {
  it("accepts a complete lead page and preserves raw fields for the journal", () => {
    const payload = {
      _page: 2,
      _links: {
        self: { href: "https://555151.amocrm.ru/api/v4/leads?page=2" },
        next: { href: "https://555151.amocrm.ru/api/v4/leads?page=3" },
      },
      _embedded: {
        leads: [
          {
            id: 7001,
            name: "Synthetic lead",
            status_id: 11,
            pipeline_id: 10243278,
            responsible_user_id: 501,
            created_at: 1_757_635_200,
            updated_at: 1_757_638_800,
            account_id: 4242,
            custom_fields_values: [
              { field_id: 77, values: [{ value: "Synthetic source" }] },
            ],
            synthetic_extra: "must remain available to raw storage",
          },
        ],
      },
    };

    const parsed = amoLeadsResponseSchema.parse(payload);

    expect(parsed._embedded.leads[0]).toMatchObject({
      id: 7001,
      updated_at: 1_757_638_800,
      synthetic_extra: "must remain available to raw storage",
    });
    expect(parsed._links?.next?.href).toContain("page=3");
  });

  it("accepts bounded official object and chained-list custom-field values", () => {
    const result = amoLeadsResponseSchema.safeParse({
      _embedded: {
        leads: [
          {
            id: 7001,
            account_id: 4242,
            created_at: 1_757_635_200,
            updated_at: 1_757_638_800,
            custom_fields_values: [
              {
                field_id: 71,
                values: [{ value: { name: "Synthetic LLC", entity_type: 2 } }],
              },
              {
                field_id: 72,
                values: [
                  {
                    value: {
                      name: "Synthetic contact",
                      entity_id: 501,
                      entity_type: "contacts",
                      catalog_id: null,
                    },
                  },
                ],
              },
              {
                field_id: 73,
                values: [
                  {
                    value: {
                      file_uuid: "3b454645-5c7f-4539-9ef9-0dd1b3638dad",
                      version_uuid: "13db6652-b3ed-4fff-aed8-0c6f3c43b887",
                      file_name: "synthetic.pdf",
                      file_size: 20763,
                    },
                  },
                ],
              },
              {
                field_id: 74,
                values: [{ catalog_id: 1001, catalog_element_id: 12235 }],
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const fields = result.data._embedded.leads[0]?.custom_fields_values;
      expect(fields?.[0]?.values).toEqual([{ value: { name: "Synthetic LLC", entity_type: 2 } }]);
      expect(fields?.[1]?.values[0]?.value).toMatchObject({ catalog_id: null });
      expect(fields?.[2]?.values[0]?.value).toMatchObject({ file_name: "synthetic.pdf" });
      expect(fields?.[3]?.values).toEqual([{ catalog_id: 1001, catalog_element_id: 12235 }]);
    }
  });

  it("rejects pathologically deep custom-field values", () => {
    let value: unknown = "leaf";
    for (let depth = 0; depth < 12; depth += 1) value = { nested: value };

    expect(
      amoLeadsResponseSchema.safeParse({
        _embedded: {
          leads: [
            {
              id: 7001,
              account_id: 4242,
              created_at: 1_757_635_200,
              updated_at: 1_757_638_800,
              custom_fields_values: [{ field_id: 77, values: [{ value }] }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a 200 lead page without the fields needed for durable ordering", () => {
    const result = amoLeadsResponseSchema.safeParse({
      _embedded: {
        leads: [
          {
            id: 7001,
            account_id: 4242,
            created_at: 1_757_635_200,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires event identity, timestamp, type, and account ownership", () => {
    expect(
      amoEventsResponseSchema.safeParse({
        _embedded: {
          events: [
            {
              id: "01pz58t6p04ymgsgfbmfyfy1mf",
              type: "lead_status_changed",
              entity_id: 7001,
              entity_type: "lead",
              created_at: 1_757_638_900,
              account_id: 4242,
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      amoEventsResponseSchema.safeParse({
        _embedded: {
          events: [
            {
              type: "lead_status_changed",
              entity_id: 7001,
              created_at: 1_757_638_900,
              account_id: 4242,
            },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      amoEventsResponseSchema.safeParse({
        _embedded: {
          events: [
            {
              id: 9001,
              type: "lead_status_changed",
              entity_id: 7001,
              entity_type: "lead",
              created_at: 1_757_638_900,
              account_id: 4242,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("treats a bounded event ID as opaque instead of imposing a numeric or slug shape", () => {
    expect(amoEventSchema.safeParse({
      id: "event:01/ABC.2",
      type: "lead_status_changed",
      entity_id: 7001,
      entity_type: "lead",
      created_at: 1_757_638_900,
      account_id: 4242,
    }).success).toBe(true);
  });

  it("rejects a user page without an immutable external id", () => {
    expect(
      amoUsersResponseSchema.safeParse({
        _embedded: { users: [{ name: "Synthetic User" }] },
      }).success,
    ).toBe(false);
  });

  it.each(["", "x".repeat(129), 9001])("rejects invalid opaque event ID %s", (id) => {
    expect(amoEventSchema.safeParse({
      id,
      type: "lead_status_changed",
      entity_id: 7001,
      entity_type: "lead",
      created_at: 1_757_638_900,
      account_id: 4242,
    }).success).toBe(false);
  });
});
