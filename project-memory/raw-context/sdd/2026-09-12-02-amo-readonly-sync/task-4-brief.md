### Task 4: Discover and activate versioned pipeline/channel configuration

**Files:**
- Create: `supabase/migrations/0003_amo_configuration.sql`
- Create: `packages/domain/src/amo/config.ts`
- Create: `packages/db/src/amo-config.ts`
- Create: `apps/web/src/app/api/config/discovery/route.ts`
- Create: `apps/web/src/app/api/config/current/route.ts`
- Create: `apps/web/src/app/api/config/validate/route.ts`
- Create: `apps/web/src/app/api/config/activate/route.ts`
- Create: `apps/web/src/app/api/config/channel-values/route.ts`
- Create: `apps/web/src/app/settings/pipeline/page.tsx`
- Create: `apps/web/src/app/settings/channels/page.tsx`
- Create: `apps/web/src/app/quality/config/page.tsx`
- Test: `packages/domain/src/amo/config.test.ts`
- Test: `apps/web/src/app/api/config/config.integration.test.ts`

**Interfaces:**
- Consumes: guarded GETs for pipelines, statuses, users, and lead custom fields.
- Produces: `PipelineConfigCandidate`, `validatePipelineConfig(candidate, discovery)`, `validateChannelRules(rules)`, `activatePipelineConfig(candidate, actorId)`, and an active immutable `pipeline_configs.version`.

- [ ] **Step 1: Write failing validation tests using the known candidate values**

```ts
it("accepts only status IDs belonging to the selected pipeline", () => {
  const candidate = { pipelineId: 10243278, applicationStatusId: 11, wonStatusId: 99, channelFieldId: 77 };
  const discovery = fixtureDiscovery({ pipelineId: 10243278, statusIds: [11, 12, 99] });
  expect(validatePipelineConfig(candidate, discovery).valid).toBe(true);
  expect(validatePipelineConfig({ ...candidate, applicationStatusId: 404 }, discovery).valid).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify missing configuration contract**

Run: `pnpm vitest run packages/domain/src/amo/config.test.ts`

Expected: FAIL because config schemas/functions do not exist.

- [ ] **Step 3: Add immutable config tables and deterministic rules**

```sql
create table pipeline_configs (
  id uuid primary key default gen_random_uuid(),
  amo_connection_id uuid not null references amo_connections(id),
  pipeline_id bigint not null,
  pipeline_name text not null,
  application_status_id bigint not null,
  application_status_name text not null,
  won_status_id bigint not null,
  won_status_name text not null,
  source_field_id bigint,
  timezone text not null default 'Europe/Moscow' check (timezone = 'Europe/Moscow'),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  confirmed_by uuid not null references app_users(id),
  confirmed_at timestamptz not null default now(),
  unique (amo_connection_id, version)
);

create unique index one_active_pipeline_config
on pipeline_configs (amo_connection_id)
where is_active;

create type channel_match_type as enum ('source_field_exact', 'tag_exact', 'integration_source_exact');

create table channel_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  priority smallint not null check (priority between 1 and 1000),
  match_type channel_match_type not null,
  match_value text not null,
  normalized_channel text not null check (normalized_channel in
    ('phone_uis','whatsapp','avito','instagram','site','telegram','max','unknown')),
  is_active boolean not null default true,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (config_id, match_type, match_value),
  unique (config_id, priority)
);

create table config_validations (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  checked_at timestamptz not null default now(),
  pipeline_found boolean not null,
  application_status_found boolean not null,
  won_status_found boolean not null,
  source_field_found boolean not null,
  metadata_checksum text not null,
  details jsonb not null default '{}'::jsonb
);
```

Activation locks the connection's config rows, confirms that the validation checksum still matches live discovery, clears the prior `is_active`, inserts the next version and its exact-match rules, then commits. The initial rule set must cover the known values in `METRICS_CATALOG.md`; duplicate `(match_type, match_value)` or priority values are rejected by both Zod and SQL. Successful activation queues a full recalculation from immutable raw rows; the current snapshot remains unchanged until that recalculation passes all quality gates. The pipeline and channel screens are admin-only; `/quality/config` is read-only for head and displays checksum/name/ID drift.

```ts
export const normalizedChannelSchema = z.enum([
  "phone_uis", "whatsapp", "avito", "instagram", "site", "telegram", "max", "unknown",
]);

export function validateChannelRules(rules: readonly ChannelRuleCandidate[]): void {
  const keys = rules.map((rule) => `${rule.matchType}\u0000${rule.matchValue}`);
  if (new Set(keys).size !== keys.length) throw new AppError("E_VALIDATION", 422);
  if (new Set(rules.map((rule) => rule.priority)).size !== rules.length) throw new AppError("E_VALIDATION", 422);
}
```

- [ ] **Step 4: Verify discovery uses only allowed GETs and activation is atomic**

Run: `supabase db reset && pnpm vitest run packages/domain/src/amo/config.test.ts && pnpm test:integration -- apps/web/src/app/api/config/config.integration.test.ts`

Expected: PASS; ID/name mismatch returns `E_CONFIG_INCOMPLETE`; failed activation leaves the previous config active; no screenshot-derived ID is accepted without API confirmation.

- [ ] **Step 5: Commit versioned pipeline configuration**

```bash
git add supabase/migrations/0003_amo_configuration.sql packages/domain packages/db apps/web/src/app/api/config apps/web/src/app/settings/pipeline apps/web/src/app/settings/channels apps/web/src/app/quality/config
git commit -m "feat: validate REAL2 pipeline configuration"
```

