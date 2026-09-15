import { describe, expect, it } from "vitest";

import {
  amoEventsResponseSchema,
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
  });

  it("rejects a user page without an immutable external id", () => {
    expect(
      amoUsersResponseSchema.safeParse({
        _embedded: { users: [{ name: "Synthetic User" }] },
      }).success,
    ).toBe(false);
  });
});
