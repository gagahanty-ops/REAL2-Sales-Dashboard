import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAmoConnection,
} from "@real2/db";
import { INITIAL_CHANNEL_RULES } from "@real2/domain";
import { decodeTokenEncryptionKey, encryptToken } from "@real2/integrations";
import {
  createAdminDb,
  resetAndSeedUsers,
  testUsers,
} from "../../../../../../tests/helpers/local-db";

import { GET as channelValuesRoute } from "./channel-values/route";
import { POST as activateRoute } from "./activate/route";
import { GET as currentRoute } from "./current/route";
import { GET as discoveryRoute } from "./discovery/route";
import { POST as validateRoute } from "./validate/route";

const adminDb = createAdminDb();

const runtime = vi.hoisted(() => ({
  db: undefined as unknown,
  env: {
    APP_URL: "https://dashboard.example.test",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "synthetic-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    AMO_CLIENT_ID: "synthetic-client-id",
    AMO_CLIENT_SECRET: "synthetic-client-secret",
    AMO_REDIRECT_URI:
      "https://dashboard.example.test/api/integrations/amo/callback",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
    SYNC_ENABLED: false,
    SHEET_PUBLISH_ENABLED: false,
  },
}));

const session = vi.hoisted(() => ({
  user: {
    id: "10000000-0000-4000-8000-000000000010",
    email: "admin@example.test",
    fullName: "Admin User",
    role: "admin" as "admin" | "head" | "manager",
    amoUserId: null,
  },
}));

vi.mock("../../../lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => session.user),
}));

vi.mock("../../../lib/server/runtime", () => ({
  getDatabase: () => runtime.db,
  getServerEnv: () => runtime.env,
}));

const candidate = {
  pipelineId: 10_243_278,
  applicationStatusId: 11,
  wonStatusId: 99,
  channelFieldId: 77,
};

class AmoDiscoveryMock {
  readonly requests: Array<{ url: string; init: RequestInit }> = [];

  constructor(
    private readonly metadata: Readonly<{
      pipelines?: readonly Readonly<{ id: number; name: string }>[];
      statuses?: readonly Readonly<{ id: number; name: string }>[];
      customFields?: readonly Readonly<{ id: number; name: string }>[];
    }> = {},
  ) {}

  readonly fetch = vi.fn(async (input: string | URL, init: RequestInit) => {
    this.requests.push({ url: String(input), init });
    const url = new URL(String(input));

    if (url.pathname === "/api/v4/leads/pipelines") {
      return Response.json({
        _embedded: {
          pipelines: this.metadata.pipelines ?? [
            { id: 10_243_278, name: "РЕАЛ ДВА" },
          ],
        },
      });
    }
    if (url.pathname === "/api/v4/leads/pipelines/10243278/statuses") {
      return Response.json({
        _embedded: {
          statuses: this.metadata.statuses ?? [
            { id: 11, name: "Завершение (самовывоз или доставка)" },
            { id: 99, name: "Успешно реализовано" },
          ],
        },
      });
    }
    if (url.pathname === "/api/v4/leads/custom_fields") {
      return Response.json({
        _embedded: {
          custom_fields: this.metadata.customFields ?? [
            { id: 77, name: "Источник сделки" },
          ],
        },
      });
    }
    if (url.pathname === "/api/v4/users") {
      return Response.json({
        _embedded: { users: [{ id: 501, name: "Synthetic User" }] },
      });
    }
    throw new Error(`Unexpected synthetic amoCRM path: ${url.pathname}`);
  });
}

function sameOriginPost(path: string, body: unknown): Request {
  return new Request(`https://dashboard.example.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://dashboard.example.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function seedActiveConnection(): Promise<void> {
  const key = decodeTokenEncryptionKey(runtime.env.TOKEN_ENCRYPTION_KEY);
  await createAmoConnection(adminDb, {
    accountId: 4_242,
    subdomain: "555151",
    baseUrl: "https://555151.amocrm.ru",
    accessTokenCiphertext: encryptToken("synthetic-config-token", key),
    refreshTokenCiphertext: encryptToken("synthetic-config-refresh", key),
    tokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    status: "active",
    installedBy: testUsers.admin.id,
    lastCheckedAt: new Date("2026-09-14T00:00:00.000Z"),
  });
}

beforeEach(async () => {
  runtime.db = adminDb;
  session.user.id = testUsers.admin.id;
  session.user.role = "admin";
  await adminDb.unsafe(
    "truncate table public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  await resetAndSeedUsers(adminDb, [testUsers.admin, testUsers.head, testUsers.managerOne]);
  await seedActiveConnection();
});

afterEach(async () => {
  await adminDb.unsafe(
    "truncate table public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs",
  );
  await adminDb`delete from public.oauth_states`;
  await adminDb`delete from public.amo_connections`;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await adminDb.end();
});

describe("pipeline configuration routes", () => {
  it("enforces status separation and duplicate channel rules in PostgreSQL", async () => {
    const [connection] = await adminDb<{ id: string }[]>`
      select id from public.amo_connections limit 1
    `;
    if (!connection) throw new Error("active connection fixture is missing");

    await expect(
      adminDb`
        insert into public.pipeline_configs (
          amo_connection_id,
          pipeline_id,
          pipeline_name,
          application_status_id,
          application_status_name,
          won_status_id,
          won_status_name,
          version,
          confirmed_by
        ) values (
          ${connection.id}, 10243278, 'РЕАЛ ДВА', 11,
          'Завершение (самовывоз или доставка)', 11,
          'Успешно реализовано', 1, ${testUsers.admin.id}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });

    const [config] = await adminDb<{ id: string }[]>`
      insert into public.pipeline_configs (
        amo_connection_id,
        pipeline_id,
        pipeline_name,
        application_status_id,
        application_status_name,
        won_status_id,
        won_status_name,
        version,
        confirmed_by
      ) values (
        ${connection.id}, 10243278, 'РЕАЛ ДВА', 11,
        'Завершение (самовывоз или доставка)', 99,
        'Успешно реализовано', 1, ${testUsers.admin.id}
      ) returning id
    `;
    if (!config) throw new Error("pipeline configuration fixture is missing");

    await adminDb`
      insert into public.channel_rules (
        config_id, priority, match_type, match_value,
        normalized_channel, created_by
      ) values (
        ${config.id}, 1, 'source_field_exact', 'Synthetic exact',
        'site', ${testUsers.admin.id}
      )
    `;
    await expect(
      adminDb`
        insert into public.channel_rules (
          config_id, priority, match_type, match_value,
          normalized_channel, created_by
        ) values (
          ${config.id}, 2, 'source_field_exact', 'Synthetic exact',
          'site', ${testUsers.admin.id}
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      adminDb`
        insert into public.channel_rules (
          config_id, priority, match_type, match_value,
          normalized_channel, created_by
        ) values (
          ${config.id}, 1, 'tag_exact', 'Synthetic tag',
          'telegram', ${testUsers.admin.id}
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("discovers only guarded amoCRM GET metadata and never serializes credentials", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);

    const response = await discoveryRoute(
      new Request("https://dashboard.example.test/api/config/discovery"),
    );
    const body = (await response.json()) as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      pipelines: [
        expect.objectContaining({
          id: 10_243_278,
          statuses: expect.arrayContaining([
            expect.objectContaining({
              id: 11,
              name: "Завершение (самовывоз или доставка)",
            }),
          ]),
        }),
      ],
      leadCustomFields: [{ id: 77, name: "Источник сделки" }],
    });
    expect(amo.requests.map(({ url, init }) => [new URL(url).pathname, init.method])).toEqual(
      expect.arrayContaining([
        ["/api/v4/leads/pipelines", "GET"],
        ["/api/v4/leads/pipelines/10243278/statuses", "GET"],
        ["/api/v4/leads/custom_fields", "GET"],
        ["/api/v4/users", "GET"],
      ]),
    );
    expect(amo.requests).toHaveLength(4);
    expect(JSON.stringify(body)).not.toMatch(
      /synthetic-config-token|synthetic-config-refresh|ciphertext|authorization/i,
    );
  });

  it("rejects duplicate discovery IDs before exposing order-dependent metadata", async () => {
    const amo = new AmoDiscoveryMock({
      pipelines: [
        { id: 10_243_278, name: "РЕАЛ ДВА" },
        { id: 10_243_278, name: "Conflicting duplicate" },
      ],
    });
    vi.stubGlobal("fetch", amo.fetch);

    const response = await discoveryRoute(
      new Request("https://dashboard.example.test/api/config/discovery"),
    );

    expect(response.status).toBe(422);
  });

  it("requires API-confirmed IDs and names before accepting a candidate", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);

    const response = await validateRoute(
      sameOriginPost("/api/config/validate", {
        ...candidate,
        applicationStatusId: 404,
      }),
    );
    const body = (await response.json()) as {
      data: { valid: boolean; code?: string };
    };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      valid: false,
      code: "E_CONFIG_INCOMPLETE",
    });
  });

  it("activates one immutable version after a fresh checksum and queues later recalculation", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { valid: boolean; metadataChecksum: string };
    };

    const activationResponse = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const activation = (await activationResponse.json()) as {
      data: { version: number; recalculationQueued: boolean };
    };

    expect(activationResponse.status).toBe(200);
    expect(activation.data).toMatchObject({ version: 1, recalculationQueued: true });
    await expect(
      adminDb<{ version: number; is_active: boolean }[]>`
        select version, is_active from public.pipeline_configs order by version
      `,
    ).resolves.toEqual([{ version: 1, is_active: true }]);
    await expect(
      adminDb<{ status: string }[]>`
        select status from public.config_recalculation_requests
      `,
    ).resolves.toEqual([{ status: "queued" }]);
  });

  it("lets only one concurrent activation consume the same expected active state", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const requestBody = {
      candidate,
      channelRules: INITIAL_CHANNEL_RULES,
      metadataChecksum: validation.data.metadataChecksum,
      expectedActiveConfigId: null,
    };

    const responses = await Promise.all([
      activateRoute(sameOriginPost("/api/config/activate", requestBody)),
      activateRoute(sameOriginPost("/api/config/activate", requestBody)),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await expect(
      adminDb<{ version: number; is_active: boolean }[]>`
        select version, is_active from public.pipeline_configs order by version
      `,
    ).resolves.toEqual([{ version: 1, is_active: true }]);
  });

  it("warns on same-ID renames and requires explicit confirmation before storing them", async () => {
    const originalAmo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", originalAmo.fetch);
    const initialValidationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const initialValidation = (await initialValidationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const initialActivation = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: initialValidation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const initial = (await initialActivation.json()) as {
      data: { configId: string };
    };

    const renamedAmo = new AmoDiscoveryMock({
      pipelines: [{ id: candidate.pipelineId, name: "РЕАЛ ДВА — новое имя" }],
      statuses: [
        { id: candidate.applicationStatusId, name: "Завершение — новое имя" },
        { id: candidate.wonStatusId, name: "Продажа — новое имя" },
      ],
    });
    vi.stubGlobal("fetch", renamedAmo.fetch);
    const renamedValidationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const renamedValidation = (await renamedValidationResponse.json()) as {
      data: {
        valid: boolean;
        metadataChecksum: string;
        requiresNameConfirmation: boolean;
        warnings: string[];
      };
    };

    expect(renamedValidationResponse.status).toBe(200);
    expect(renamedValidation.data).toMatchObject({
      valid: true,
      requiresNameConfirmation: true,
      warnings: [
        "pipeline_name_changed",
        "application_status_name_changed",
        "won_status_name_changed",
      ],
    });

    const activationBody = {
      candidate,
      channelRules: INITIAL_CHANNEL_RULES,
      metadataChecksum: renamedValidation.data.metadataChecksum,
      expectedActiveConfigId: initial.data.configId,
    };
    const unconfirmed = await activateRoute(
      sameOriginPost("/api/config/activate", activationBody),
    );
    expect(unconfirmed.status).toBe(422);

    const confirmed = await activateRoute(
      sameOriginPost("/api/config/activate", {
        ...activationBody,
        confirmNameChanges: true,
      }),
    );
    expect(confirmed.status).toBe(200);
    await expect(
      adminDb<{
        version: number;
        pipeline_name: string;
        application_status_name: string;
        won_status_name: string;
        is_active: boolean;
      }[]>`
        select version, pipeline_name, application_status_name,
          won_status_name, is_active
        from public.pipeline_configs
        order by version
      `,
    ).resolves.toEqual([
      {
        version: 1,
        pipeline_name: "РЕАЛ ДВА",
        application_status_name: "Завершение (самовывоз или доставка)",
        won_status_name: "Успешно реализовано",
        is_active: false,
      },
      {
        version: 2,
        pipeline_name: "РЕАЛ ДВА — новое имя",
        application_status_name: "Завершение — новое имя",
        won_status_name: "Продажа — новое имя",
        is_active: true,
      },
    ]);
  });

  it("requires confirmation when renamed IDs return to their canonical names", async () => {
    const originalAmo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", originalAmo.fetch);
    const initialValidationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const initialValidation = (await initialValidationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const initialActivationResponse = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: initialValidation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const initialActivation = (await initialActivationResponse.json()) as {
      data: { configId: string };
    };

    const renamedAmo = new AmoDiscoveryMock({
      pipelines: [{ id: candidate.pipelineId, name: "РЕАЛ ДВА — новое имя" }],
      statuses: [
        { id: candidate.applicationStatusId, name: "Завершение — новое имя" },
        { id: candidate.wonStatusId, name: "Продажа — новое имя" },
      ],
    });
    vi.stubGlobal("fetch", renamedAmo.fetch);
    const renamedValidationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const renamedValidation = (await renamedValidationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const renamedActivationResponse = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: renamedValidation.data.metadataChecksum,
        expectedActiveConfigId: initialActivation.data.configId,
        confirmNameChanges: true,
      }),
    );
    const renamedActivation = (await renamedActivationResponse.json()) as {
      data: { configId: string };
    };

    const revertedAmo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", revertedAmo.fetch);
    const revertedValidationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const revertedValidation = (await revertedValidationResponse.json()) as {
      data: {
        valid: boolean;
        metadataChecksum: string;
        requiresNameConfirmation: boolean;
        warnings: string[];
      };
    };

    expect(revertedValidationResponse.status).toBe(200);
    expect(revertedValidation.data).toMatchObject({
      valid: true,
      requiresNameConfirmation: true,
      warnings: [
        "pipeline_name_changed",
        "application_status_name_changed",
        "won_status_name_changed",
      ],
    });

    const reversalBody = {
      candidate,
      channelRules: INITIAL_CHANNEL_RULES,
      metadataChecksum: revertedValidation.data.metadataChecksum,
      expectedActiveConfigId: renamedActivation.data.configId,
    };
    const unconfirmed = await activateRoute(
      sameOriginPost("/api/config/activate", reversalBody),
    );
    expect(unconfirmed.status).toBe(422);

    const confirmed = await activateRoute(
      sameOriginPost("/api/config/activate", {
        ...reversalBody,
        confirmNameChanges: true,
      }),
    );
    const confirmedBody = (await confirmed.json()) as {
      data: { version: number };
    };
    expect(confirmed.status).toBe(200);
    expect(confirmedBody.data.version).toBe(3);
    await expect(
      adminDb<{
        version: number;
        pipeline_name: string;
        application_status_name: string;
        won_status_name: string;
        is_active: boolean;
      }[]>`
        select version, pipeline_name, application_status_name,
          won_status_name, is_active
        from public.pipeline_configs
        order by version
      `,
    ).resolves.toEqual([
      {
        version: 1,
        pipeline_name: "РЕАЛ ДВА",
        application_status_name: "Завершение (самовывоз или доставка)",
        won_status_name: "Успешно реализовано",
        is_active: false,
      },
      {
        version: 2,
        pipeline_name: "РЕАЛ ДВА — новое имя",
        application_status_name: "Завершение — новое имя",
        won_status_name: "Продажа — новое имя",
        is_active: false,
      },
      {
        version: 3,
        pipeline_name: "РЕАЛ ДВА",
        application_status_name: "Завершение (самовывоз или доставка)",
        won_status_name: "Успешно реализовано",
        is_active: true,
      },
    ]);
  });

  it("activates editable exact source-field, tag, and integration mappings", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const editableRules = [
      ...INITIAL_CHANNEL_RULES,
      {
        priority: INITIAL_CHANNEL_RULES.length + 1,
        matchType: "source_field_exact" as const,
        matchValue: "Synthetic source",
        normalizedChannel: "unknown" as const,
      },
      {
        priority: INITIAL_CHANNEL_RULES.length + 2,
        matchType: "tag_exact" as const,
        matchValue: "Synthetic tag",
        normalizedChannel: "telegram" as const,
      },
      {
        priority: INITIAL_CHANNEL_RULES.length + 3,
        matchType: "integration_source_exact" as const,
        matchValue: "Synthetic integration",
        normalizedChannel: "whatsapp" as const,
      },
    ];

    const response = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: editableRules,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );

    expect(response.status).toBe(200);
    await expect(
      adminDb<{ match_type: string; match_value: string }[]>`
        select match_type, match_value
        from public.channel_rules
        where match_value like 'Synthetic %'
        order by priority
      `,
    ).resolves.toEqual([
      { match_type: "source_field_exact", match_value: "Synthetic source" },
      { match_type: "tag_exact", match_value: "Synthetic tag" },
      {
        match_type: "integration_source_exact",
        match_value: "Synthetic integration",
      },
    ]);
  });

  it("leaves the prior active version intact when activation has a stale checksum", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const firstActivation = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const first = (await firstActivation.json()) as { data: { configId: string } };

    const rejected = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: "0".repeat(64),
        expectedActiveConfigId: first.data.configId,
      }),
    );

    expect(rejected.status).toBe(409);
    await expect(
      adminDb<{ version: number; is_active: boolean }[]>`
        select version, is_active from public.pipeline_configs order by version
      `,
    ).resolves.toEqual([{ version: 1, is_active: true }]);
  });

  it("keeps source-field mappings as inactive history when a version has no source field", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const noSourceFieldCandidate = {
      pipelineId: candidate.pipelineId,
      applicationStatusId: candidate.applicationStatusId,
      wonStatusId: candidate.wonStatusId,
      channelFieldId: null,
    };
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", noSourceFieldCandidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };

    const activation = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate: noSourceFieldCandidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );

    expect(activation.status).toBe(200);
    await expect(
      adminDb<{ is_active: boolean }[]>`
        select is_active
        from public.channel_rules
        order by priority
      `,
    ).resolves.toEqual(
      INITIAL_CHANNEL_RULES.map(() => ({ is_active: false })),
    );
  });

  it("rolls back deactivation when a database write fails inside activation", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    const firstActivation = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const first = (await firstActivation.json()) as { data: { configId: string } };

    session.user.id = "10000000-0000-4000-8000-000000000099";
    const rejected = await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: first.data.configId,
      }),
    );

    expect(rejected.status).toBe(409);
    await expect(
      adminDb<{ version: number; is_active: boolean }[]>`
        select version, is_active from public.pipeline_configs order by version
      `,
    ).resolves.toEqual([{ version: 1, is_active: true }]);
  });

  it("rejects mutation of an activated version and its exact-match rules", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );

    await expect(
      adminDb`
        update public.pipeline_configs
        set pipeline_name = 'Tampered Pipeline'
        where version = 1
      `,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      adminDb`
        delete from public.channel_rules
        where priority = 1
      `,
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("allows head to read safe current configuration but blocks settings discovery", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    session.user.role = "head";

    const current = await currentRoute(
      new Request("https://dashboard.example.test/api/config/current"),
    );
    const discovery = await discoveryRoute(
      new Request("https://dashboard.example.test/api/config/discovery"),
    );
    const values = await channelValuesRoute(
      new Request("https://dashboard.example.test/api/config/channel-values"),
    );

    expect(current.status).toBe(200);
    expect(JSON.stringify(await current.json())).not.toMatch(
      /ciphertext|token|connection_id|confirmed_by/i,
    );
    expect(values.status).toBe(200);
    expect(discovery.status).toBe(403);
  });

  it("returns truthful counts from latest successful raw lead snapshots", async () => {
    const amo = new AmoDiscoveryMock();
    vi.stubGlobal("fetch", amo.fetch);
    const validationResponse = await validateRoute(
      sameOriginPost("/api/config/validate", candidate),
    );
    const validation = (await validationResponse.json()) as {
      data: { metadataChecksum: string };
    };
    await activateRoute(
      sameOriginPost("/api/config/activate", {
        candidate,
        channelRules: INITIAL_CHANNEL_RULES,
        metadataChecksum: validation.data.metadataChecksum,
        expectedActiveConfigId: null,
      }),
    );
    const [binding] = await adminDb<{ connection_id: string; config_id: string }[]>`
      select amo_connection_id as connection_id, id as config_id
      from public.pipeline_configs
      where is_active
    `;
    if (!binding) throw new Error("active configuration fixture is missing");
    const [run] = await adminDb<{ id: string }[]>`
      insert into public.sync_runs (
        trace_id, connection_id, config_id, kind, status, finished_at
      ) values (
        'trace-channel-values', ${binding.connection_id}, ${binding.config_id},
        'incremental', 'success', '2026-09-15T09:01:00.000Z'
      )
      returning id
    `;
    if (!run) throw new Error("successful sync fixture is missing");
    await adminDb`
      insert into public.raw_amo_objects (
        sync_run_id, account_id, entity_type, external_id,
        source_updated_at, payload, payload_sha256
      ) values
        (
          ${run.id}, 4242, 'lead', 7001, '2026-09-15T08:00:00.000Z',
          ${adminDb.json({ id: 7001, custom_fields_values: [{ field_id: 77, values: [{ value: "Avito" }] }] })},
          ${"a".repeat(64)}
        ),
        (
          ${run.id}, 4242, 'lead', 7002, '2026-09-15T08:00:00.000Z',
          ${adminDb.json({ id: 7002, custom_fields_values: [{ field_id: 77, values: [{ value: "Avito" }] }] })},
          ${"b".repeat(64)}
        ),
        (
          ${run.id}, 4242, 'lead', 7003, '2026-09-15T08:00:00.000Z',
          ${adminDb.json({ id: 7003, custom_fields_values: [{ field_id: 77, values: [{ value: "WhatsApp" }] }] })},
          ${"c".repeat(64)}
        )
    `;

    const response = await channelValuesRoute(
      new Request("https://dashboard.example.test/api/config/channel-values"),
    );
    const body = (await response.json()) as {
      data: { configVersion: number; values: Array<{ value: string; count: number }> };
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      configVersion: 1,
      values: [
        { value: "Avito", count: 2 },
        { value: "WhatsApp", count: 1 },
      ],
    });
  });

});
