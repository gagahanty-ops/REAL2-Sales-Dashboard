-- Sheet publication targets, layout mappings, publication attempts and system
-- alerts (SPEC M9-M10). Numbered 0012 because migrations 0005-0011 are
-- reviewed and immutable; the plan's illustrative `0007` name is taken.
--
-- Nothing here enables publication: `system_controls` keeps both switches
-- false, and this migration only asserts that fact.

create type public.sheet_target_status as enum ('draft', 'validated', 'active', 'disabled');
create type public.sheet_report_kind as enum ('channels_daily', 'plan_fact');
create type public.sheet_value_type as enum ('integer', 'money', 'percent', 'date', 'text');

create table public.sheet_targets (
  id uuid primary key default gen_random_uuid(),
  spreadsheet_id text not null unique
    check (char_length(spreadsheet_id) between 10 and 200),
  expected_title text not null check (char_length(expected_title) between 1 and 200),
  status public.sheet_target_status not null default 'draft',
  layout_fingerprint text
    check (layout_fingerprint is null or layout_fingerprint ~ '^[a-f0-9]{64}$'),
  validated_at timestamptz,
  activated_by uuid references public.app_users(id),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  -- The protected original can never become a target, whatever a caller sends.
  check (spreadsheet_id <> '123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks'),
  check (status <> 'active' or (layout_fingerprint is not null and activated_by is not null))
);

create unique index one_active_sheet_target
  on public.sheet_targets ((status)) where status = 'active';

create table public.sheet_layout_mappings (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.sheet_targets(id),
  report_kind public.sheet_report_kind not null,
  logical_field text not null check (char_length(logical_field) between 1 and 80),
  sheet_name text not null check (char_length(sheet_name) between 1 and 100),
  range_a1 text not null check (range_a1 ~ '^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$'),
  value_type public.sheet_value_type not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (target_id, report_kind, logical_field),
  unique (target_id, sheet_name, range_a1)
);

create type public.publication_status as enum ('running', 'success', 'failed', 'blocked');

create table public.sheet_publications (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique check (char_length(trace_id) between 1 and 128),
  target_id uuid not null references public.sheet_targets(id),
  snapshot_id uuid not null references public.metric_snapshots(id),
  attempt integer not null check (attempt > 0),
  status public.publication_status not null default 'running',
  layout_fingerprint text not null check (layout_fingerprint ~ '^[a-f0-9]{64}$'),
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  cells_planned integer not null check (cells_planned >= 0),
  cells_written integer not null default 0 check (cells_written >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) between 1 and 80),
  error_summary text
    check (error_summary is null or char_length(error_summary) between 1 and 500),
  unique (target_id, snapshot_id, attempt),
  check (status = 'running' or finished_at is not null),
  check (status <> 'success' or cells_written = cells_planned)
);

create unique index one_successful_snapshot_publication
  on public.sheet_publications (target_id, snapshot_id)
  where status = 'success';

create type public.alert_severity as enum ('info', 'warning', 'critical');
create type public.alert_status as enum ('open', 'acknowledged', 'resolved');

create table public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null check (char_length(trace_id) between 1 and 128),
  source text not null check (char_length(source) between 1 and 80),
  code text not null check (char_length(code) between 1 and 80),
  severity public.alert_severity not null,
  status public.alert_status not null default 'open',
  safe_summary text not null check (char_length(safe_summary) between 1 and 500),
  safe_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_context) = 'object'),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references public.app_users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create unique index system_alerts_one_open_idx
  on public.system_alerts (source, code) where status = 'open';

-- Publication evidence is immutable once an attempt has finished.
create function public.prevent_finished_publication_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Publication attempts are never deleted' using errcode = 'P0001';
  end if;
  if old.status <> 'running' then
    raise exception 'Finished publication attempts are immutable' using errcode = 'P0001';
  end if;
  if
    new.trace_id is distinct from old.trace_id
    or new.target_id is distinct from old.target_id
    or new.snapshot_id is distinct from old.snapshot_id
    or new.attempt is distinct from old.attempt
    or new.layout_fingerprint is distinct from old.layout_fingerprint
    or new.payload_checksum is distinct from old.payload_checksum
    or new.started_at is distinct from old.started_at
  then
    raise exception 'Publication evidence is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger sheet_publications_immutable
before update or delete on public.sheet_publications
for each row execute function public.prevent_finished_publication_rewrite();

alter table public.sheet_targets enable row level security;
alter table public.sheet_layout_mappings enable row level security;
alter table public.sheet_publications enable row level security;
alter table public.system_alerts enable row level security;

revoke all on table public.sheet_targets, public.sheet_layout_mappings,
  public.sheet_publications, public.system_alerts from anon, authenticated;

grant select on table public.sheet_targets, public.sheet_layout_mappings,
  public.sheet_publications, public.system_alerts to authenticated;

create policy sheet_targets_leadership_select
on public.sheet_targets for select to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy sheet_layout_mappings_leadership_select
on public.sheet_layout_mappings for select to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy sheet_publications_leadership_select
on public.sheet_publications for select to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy system_alerts_leadership_select
on public.system_alerts for select to authenticated
using ((select app.current_role()) in ('admin', 'head'));

-- The publisher role may read the active target, its mappings and approved
-- snapshots, and may write only its own publication rows and alerts. It can
-- reach neither OAuth tokens, nor raw amoCRM pages, nor the switches.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sheet_publisher') then
    create role sheet_publisher nologin noinherit nobypassrls;
  end if;
end
$$;

grant usage on schema public to sheet_publisher;
grant sheet_publisher to postgres, service_role;
grant select on table public.sheet_targets, public.sheet_layout_mappings,
  public.metric_snapshots, public.metric_cells, public.metric_lead_facts,
  public.stage_snapshot_rows, public.current_snapshot, public.sales_plans,
  public.system_controls to sheet_publisher;
grant select, insert on table public.sheet_publications to sheet_publisher;
grant update (status, cells_written, finished_at, error_code, error_summary)
  on public.sheet_publications to sheet_publisher;
grant select, insert on table public.system_alerts to sheet_publisher;
grant update (status, occurrence_count, last_seen_at, safe_context)
  on public.system_alerts to sheet_publisher;

-- Both switches must still be off: a migration never enables an external write.
do $$
declare
  enabled_count integer;
begin
  select count(*) into enabled_count
  from public.system_controls
  where key in ('sync_enabled', 'sheet_publish_enabled') and enabled;

  if enabled_count <> 0 then
    raise exception 'External switches must be disabled at migration time'
      using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.system_controls
    where key in ('sync_enabled', 'sheet_publish_enabled')
  ) <> 2 then
    raise exception 'Both control rows must exist before publication schema'
      using errcode = 'P0001';
  end if;
end
$$;
