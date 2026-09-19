import postgres from "postgres";

/**
 * Deterministic end-to-end fixture: four synthetic identities and one approved
 * snapshot. Everything is local and fictional; no amoCRM or Google call is
 * made, and both external switches stay off.
 */

export type E2EIdentity = Readonly<{
  key: "admin" | "head" | "manager-one" | "manager-two";
  email: string;
  fullName: string;
  role: "admin" | "head" | "manager";
  amoUserId: number | null;
}>;

export const E2E_IDENTITIES: readonly E2EIdentity[] = [
  { key: "admin", email: "e2e.admin@example.test", fullName: "Админ Е2Е", role: "admin", amoUserId: null },
  { key: "head", email: "e2e.head@example.test", fullName: "Руководитель Е2Е", role: "head", amoUserId: null },
  { key: "manager-one", email: "e2e.manager.one@example.test", fullName: "Менеджер Один", role: "manager", amoUserId: 42 },
  { key: "manager-two", email: "e2e.manager.two@example.test", fullName: "Менеджер Два", role: "manager", amoUserId: 84 },
];

export const E2E_ACCOUNT_ID = 9001;
export const E2E_FROM = "2026-09-05";
export const E2E_TO = "2026-09-06";

const TRUNCATE = "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
}

export async function seedDashboardE2E(): Promise<Readonly<{ snapshotVersion: number }>> {
  const password = requireEnv("E2E_PASSWORD");
  const sql = postgres(requireEnv("DATABASE_URL"), { max: 2, onnotice: () => {} });
  const authUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  /** GoTrue admin API over plain fetch: no extra dependency in the test tree. */
  async function authAdmin<T>(
    path: string,
    init: Readonly<{ method: string; body?: unknown }>,
  ): Promise<T> {
    const response = await fetch(`${authUrl}/auth/v1/admin${path}`, {
      method: init.method,
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      throw new Error(`auth admin ${path} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  try {
    await sql.unsafe(TRUNCATE);
    await sql`delete from public.oauth_states`;
    await sql`delete from public.amo_connections`;
    await sql`delete from public.app_users`;

    const authIds = new Map<string, string>();
    const existing = await authAdmin<{ users: { id: string; email: string }[] }>(
      "/users?per_page=200",
      { method: "GET" },
    );
    for (const identity of E2E_IDENTITIES) {
      const found = existing.users.find((user) => user.email === identity.email);
      if (found) {
        await authAdmin(`/users/${found.id}`, {
          method: "PUT",
          body: { password, email_confirm: true },
        });
        authIds.set(identity.key, found.id);
        continue;
      }
      const created = await authAdmin<{ id: string }>("/users", {
        method: "POST",
        body: { email: identity.email, password, email_confirm: true },
      });
      authIds.set(identity.key, created.id);
    }

    for (const identity of E2E_IDENTITIES) {
      await sql`
        insert into public.app_users (
          auth_user_id, email, full_name, role, amo_user_id, is_active
        ) values (
          ${authIds.get(identity.key) as string}, ${identity.email}, ${identity.fullName},
          ${identity.role}, ${identity.amoUserId}, true
        )
      `;
    }

    const [actor] = await sql<{ id: string }[]>`
      select id from public.app_users where role = 'admin' limit 1
    `;
    if (!actor) throw new Error("missing admin fixture");

    const [connection] = await sql<{ id: string }[]>`
      insert into public.amo_connections (
        account_id, subdomain, base_url, access_token_ciphertext,
        refresh_token_ciphertext, token_expires_at, status, installed_by
      ) values (
        ${E2E_ACCOUNT_ID}, '555151', 'https://555151.amocrm.ru', ${Buffer.alloc(64)},
        ${Buffer.alloc(64)}, '2030-01-01T00:00:00Z', 'active', ${actor.id}
      ) returning id
    `;
    if (!connection) throw new Error("missing connection fixture");
    const [config] = await sql<{ id: string }[]>`
      insert into public.pipeline_configs (
        amo_connection_id, pipeline_id, pipeline_name, application_status_id,
        application_status_name, won_status_id, won_status_name, version,
        is_active, confirmed_by
      ) values (
        ${connection.id}, 77, 'Продажи', 771, 'Заявка', 772, 'Успешно реализовано',
        1, true, ${actor.id}
      ) returning id
    `;
    if (!config) throw new Error("missing configuration fixture");
    const [run] = await sql<{ id: string }[]>`
      insert into public.sync_runs (
        trace_id, connection_id, config_id, kind, status, started_at, finished_at,
        source_max_updated_at
      ) values (
        ${`e2e-${Date.now()}`}, ${connection.id}, ${config.id}, 'incremental',
        'success', now() - interval '4 minutes', now() - interval '1 minute',
        now() - interval '2 minutes'
      ) returning id
    `;
    if (!run) throw new Error("missing run fixture");

    for (const [statusId, name, sort] of [
      [770, "Первичный контакт", 10],
      [771, "Заявка", 20],
      [772, "Успешно реализовано", 30],
    ] as const) {
      await sql`
        insert into public.pipeline_statuses (
          account_id, pipeline_id, status_id, name, sort_order, is_closed, is_won
        ) values (
          ${E2E_ACCOUNT_ID}, 77, ${statusId}, ${name}, ${sort}, ${statusId === 772},
          ${statusId === 772}
        )
      `;
    }
    for (const identity of E2E_IDENTITIES) {
      if (identity.amoUserId === null) continue;
      await sql`
        insert into public.amo_users (account_id, amo_user_id, name, email, is_active)
        values (${E2E_ACCOUNT_ID}, ${identity.amoUserId}, ${identity.fullName}, null, true)
      `;
    }

    // The normalized layer as well: the lead card reads it, not the snapshot.
    for (const [id, name, date, manager, channel, status, price, won] of [
      [1001, 'Сделка #1001', E2E_FROM, 42, 'site', 772, '120000.00', true],
      [1002, 'Сделка #1002', E2E_FROM, 42, 'site', 770, null, false],
      [1003, 'Сделка #1003', E2E_FROM, 84, 'avito', 771, null, false],
      [1004, 'Сделка #1004', E2E_TO, 84, 'site', 770, null, false],
    ] as const) {
      await sql`
        insert into public.leads (
          account_id, amo_lead_id, pipeline_id, current_status_id,
          current_responsible_user_id, name, price_rub, created_at, created_date,
          source_updated_at, normalized_channel, normalization_config_id, amo_url
        ) values (
          ${E2E_ACCOUNT_ID}, ${id}, 77, ${status}, ${manager}, ${name}, ${price},
          ${`${date}T09:00:00Z`}, ${date}, ${`${date}T09:30:00Z`}, ${channel},
          ${config.id}, ${`https://555151.amocrm.ru/leads/detail/${id}`}
        )
      `;
      await sql`
        insert into public.lead_milestones (
          account_id, amo_lead_id, application_at, application_responsible_user_id,
          won_at, won_responsible_user_id, currently_won
        ) values (
          ${E2E_ACCOUNT_ID}, ${id},
          ${won || status >= 771 ? `${date}T10:00:00Z` : null}, ${manager},
          ${won ? `${date}T12:00:00Z` : null}, ${won ? manager : null}, ${won}
        )
      `;
      await sql`
        insert into public.lead_stage_events (
          account_id, amo_event_id, amo_lead_id, from_status_id, to_status_id,
          responsible_user_id, occurred_at
        ) values (
          ${E2E_ACCOUNT_ID}, ${`e2e-stage-${id}`}, ${id}, 770, ${status}, ${manager},
          ${`${date}T10:00:00Z`}
        )
      `;
    }

    const [snapshot] = await sql<{ id: string; version: string }[]>`
      insert into public.metric_snapshots (
        sync_run_id, config_id, source_fresh_at, checksum, quality_summary
      ) values (
        ${run.id}, ${config.id}, now() - interval '2 minutes', ${"a".repeat(64)},
        ${sql.json({ unknown_channel_count: 1 })}
      ) returning id, version
    `;
    if (!snapshot) throw new Error("missing snapshot fixture");

    const cells = [
      [E2E_FROM, "all", "all", 3, 2, 1, "120000.00"],
      [E2E_FROM, "42", "all", 2, 1, 1, "120000.00"],
      [E2E_FROM, "84", "all", 1, 1, 0, "0.00"],
      [E2E_FROM, "all", "site", 2, 1, 1, "120000.00"],
      [E2E_FROM, "all", "avito", 1, 1, 0, "0.00"],
      [E2E_FROM, "42", "site", 2, 1, 1, "120000.00"],
      [E2E_FROM, "84", "avito", 1, 1, 0, "0.00"],
      [E2E_TO, "all", "all", 1, 0, 0, "0.00"],
      [E2E_TO, "84", "all", 1, 0, 0, "0.00"],
      [E2E_TO, "all", "site", 1, 0, 0, "0.00"],
      [E2E_TO, "84", "site", 1, 0, 0, "0.00"],
    ] as const;
    for (const [date, manager, channel, leads, applications, payments, revenue] of cells) {
      await sql`
        insert into public.metric_cells (
          snapshot_id, report_date, manager_key, channel_key, leads_created,
          applications, payments, revenue
        ) values (
          ${snapshot.id}, ${date}, ${manager}, ${channel}, ${leads}, ${applications},
          ${payments}, ${revenue}
        )
      `;
    }

    const facts = [
      [1001, "Сделка #1001", E2E_FROM, "42", "Менеджер Один", "site", 772, "120000.00", true, ["unknown_channel"]],
      [1002, "Сделка #1002", E2E_FROM, "42", "Менеджер Один", "site", 770, null, false, []],
      [1003, "Сделка #1003", E2E_FROM, "84", "Менеджер Два", "avito", 771, null, false, []],
      [1004, "Сделка #1004", E2E_TO, "84", "Менеджер Два", "site", 770, null, false, []],
    ] as const;
    for (const [id, name, date, manager, managerName, channel, status, price, won, codes] of facts) {
      await sql`
        insert into public.metric_lead_facts (
          snapshot_id, account_id, amo_lead_id, display_name, report_date,
          manager_key, manager_name, channel_key, current_status_id, price_rub,
          application_at, won_at, currently_won, amo_url, quality_codes
        ) values (
          ${snapshot.id}, ${E2E_ACCOUNT_ID}, ${id}, ${name}, ${date}, ${manager},
          ${managerName}, ${channel}, ${status}, ${price},
          ${won ? "2026-09-05T10:00:00Z" : null}, ${won ? "2026-09-05T12:00:00Z" : null},
          ${won}, ${`https://555151.amocrm.ru/leads/detail/${id}`}, ${sql.array([...codes])}
        )
      `;
    }

    await sql`
      insert into public.stage_snapshot_rows (
        snapshot_id, status_id, status_name, manager_key, open_count, open_amount,
        median_age_seconds, average_age_seconds
      ) values
        (${snapshot.id}, 770, 'Первичный контакт', '42', 1, '0.00', 3600, 3600),
        (${snapshot.id}, 770, 'Первичный контакт', '84', 1, '0.00', 7200, 7200),
        (${snapshot.id}, 771, 'Заявка', '84', 1, '0.00', 1800, 1800)
    `;
    await sql`
      insert into public.data_quality_issues (
        account_id, amo_lead_id, code, severity, status
      ) values (${E2E_ACCOUNT_ID}, 1001, 'unknown_channel', 'warning', 'open')
    `;
    await sql`
      update public.metric_snapshots set status = 'approved', approved_at = now()
      where id = ${snapshot.id}
    `;
    await sql`
      insert into public.current_snapshot (singleton, snapshot_id) values (true, ${snapshot.id})
      on conflict (singleton) do update set snapshot_id = excluded.snapshot_id
    `;

    return { snapshotVersion: Number(snapshot.version) };
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedDashboardE2E()
    .then((result) => {
      process.stdout.write(`seeded snapshot ${result.snapshotVersion}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}
