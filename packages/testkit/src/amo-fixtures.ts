export const syntheticAmoFixtures = {
  account: { id: 9001, subdomain: "555151" },
  pipelinesPage: {
    _embedded: {
      pipelines: [{ id: 77, name: "Synthetic sales", account_id: 9001 }],
    },
  },
  statusesPage: {
    _embedded: {
      statuses: [
        { id: 771, name: "Application", pipeline_id: 77, account_id: 9001 },
        { id: 772, name: "Won", pipeline_id: 77, account_id: 9001 },
      ],
    },
  },
  usersPage: {
    _embedded: { users: [{ id: 501, name: "Synthetic Manager" }] },
  },
  eventsPage(page = 1, hasNext = false) {
    return {
      _page: page,
      _embedded: {
        events: [
          {
            id: `event:${page}`,
            type: "lead_status_changed",
            entity_id: page,
            entity_type: "lead",
            created_at: 1_789_470_000 + page,
            account_id: 9001,
          },
        ],
      },
      ...(hasNext
        ? {
            _links: {
              next: {
                href: `https://555151.amocrm.ru/api/v4/events?page=${page + 1}`,
              },
            },
          }
        : {}),
    };
  },
  leadsPage(page = 1, hasNext = false) {
    return {
      _page: page,
      _embedded: {
        leads: [
          {
            id: page,
            account_id: 9001,
            created_at: 1_789_470_000,
            updated_at: 1_789_470_000 + page,
            pipeline_id: 77,
          },
        ],
      },
      ...(hasNext
        ? {
            _links: {
              next: {
                href: `https://555151.amocrm.ru/api/v4/leads?page=${page + 1}`,
              },
            },
          }
        : {}),
    };
  },
} as const;
