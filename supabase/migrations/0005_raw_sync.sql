create type public.sync_kind as enum (
  'initial_backfill',
  'incremental',
  'nightly_reconciliation',
  'manual'
);

create type public.sync_status as enum (
  'running',
  'success',
  'partial',
  'failed'
);

create type public.raw_entity_type as enum (
  'account',
  'pipeline',
  'status',
  'user',
  'lead'
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique check (char_length(trace_id) between 1 and 128),
  connection_id uuid not null references public.amo_connections(id),
  config_id uuid not null references public.pipeline_configs(id),
  kind public.sync_kind not null,
  status public.sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_read integer not null default 0 check (pages_read >= 0),
  leads_read integer not null default 0 check (leads_read >= 0),
  events_read integer not null default 0 check (events_read >= 0),
  users_read integer not null default 0 check (users_read >= 0),
  retries integer not null default 0 check (retries >= 0),
  source_max_updated_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) between 1 and 80),
  error_summary text check (error_summary is null or char_length(error_summary) between 1 and 500),
  checksum text check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.app_users(id),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create table public.sync_cursors (
  connection_id uuid not null references public.amo_connections(id),
  stream text not null check (stream in ('leads', 'events', 'users', 'metadata')),
  cursor_time timestamptz,
  cursor_external_id bigint check (cursor_external_id is null or cursor_external_id > 0),
  last_successful_run_id uuid references public.sync_runs(id),
  updated_at timestamptz not null default now(),
  primary key (connection_id, stream)
);

create table public.sync_pages (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id),
  stream text not null check (stream in ('leads', 'events', 'users', 'metadata')),
  page_number integer not null check (page_number > 0),
  item_count integer not null check (item_count >= 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  unique (sync_run_id, stream, page_number)
);

create table public.raw_amo_objects (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id),
  account_id bigint not null check (account_id > 0),
  entity_type public.raw_entity_type not null,
  external_id bigint not null check (external_id > 0),
  source_updated_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  unique (sync_run_id, entity_type, external_id)
);

create table public.raw_amo_events (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id),
  account_id bigint not null check (account_id > 0),
  amo_event_id bigint not null check (amo_event_id > 0),
  amo_lead_id bigint check (amo_lead_id is null or amo_lead_id > 0),
  event_type text not null check (char_length(event_type) between 1 and 200),
  event_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  unique (account_id, amo_event_id)
);

create table public.raw_amo_quarantine (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id),
  stream text not null check (stream in ('leads', 'events', 'users', 'metadata')),
  page_number integer not null check (page_number > 0),
  reason_code text not null check (char_length(reason_code) between 1 and 80),
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  unique (sync_run_id, stream, page_number, payload_sha256)
);

create table public.amo_api_audit (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references public.sync_runs(id),
  trace_id text not null check (char_length(trace_id) between 1 and 128),
  method text not null check (method in ('GET', 'POST', 'PATCH', 'PUT', 'DELETE')),
  normalized_path text not null check (
    normalized_path like '/%'
    and position('?' in normalized_path) = 0
    and position('#' in normalized_path) = 0
    and char_length(normalized_path) <= 500
  ),
  response_status integer check (response_status is null or response_status between 100 and 599),
  duration_ms integer not null check (duration_ms >= 0),
  attempt smallint not null check (attempt > 0),
  result text not null check (result in ('allowed', 'denied', 'success', 'error')),
  created_at timestamptz not null default now()
);

create index raw_objects_lookup_idx
on public.raw_amo_objects (entity_type, external_id, received_at desc);

create index raw_events_lead_idx
on public.raw_amo_events (amo_lead_id, event_at, amo_event_id);

create index raw_quarantine_page_idx
on public.raw_amo_quarantine (sync_run_id, stream, page_number);

create index sync_pages_run_idx
on public.sync_pages (sync_run_id, stream, page_number);

create index sync_runs_status_idx
on public.sync_runs (status, started_at desc);

create index amo_api_audit_run_idx
on public.amo_api_audit (sync_run_id, created_at);

alter table public.sync_runs enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.sync_pages enable row level security;
alter table public.raw_amo_objects enable row level security;
alter table public.raw_amo_events enable row level security;
alter table public.raw_amo_quarantine enable row level security;
alter table public.amo_api_audit enable row level security;

revoke all on table public.sync_runs from anon, authenticated;
revoke all on table public.sync_cursors from anon, authenticated;
revoke all on table public.sync_pages from anon, authenticated;
revoke all on table public.raw_amo_objects from anon, authenticated;
revoke all on table public.raw_amo_events from anon, authenticated;
revoke all on table public.raw_amo_quarantine from anon, authenticated;
revoke all on table public.amo_api_audit from anon, authenticated;

grant select on table public.sync_runs, public.sync_pages, public.amo_api_audit
to authenticated;

grant select on table public.raw_amo_objects, public.raw_amo_events,
  public.raw_amo_quarantine
to authenticated;

create policy sync_runs_leadership_select
on public.sync_runs
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy sync_pages_leadership_select
on public.sync_pages
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy amo_api_audit_leadership_select
on public.amo_api_audit
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy raw_amo_objects_admin_select
on public.raw_amo_objects
for select
to authenticated
using ((select app.current_role()) = 'admin');

create policy raw_amo_events_admin_select
on public.raw_amo_events
for select
to authenticated
using ((select app.current_role()) = 'admin');

create policy raw_amo_quarantine_admin_select
on public.raw_amo_quarantine
for select
to authenticated
using ((select app.current_role()) = 'admin');

grant select, insert on table public.sync_runs to service_worker;
grant update (
  status,
  finished_at,
  pages_read,
  leads_read,
  events_read,
  users_read,
  retries,
  source_max_updated_at,
  error_code,
  error_summary,
  checksum
) on public.sync_runs to service_worker;

grant select, insert on table public.sync_cursors to service_worker;
grant update (
  cursor_time,
  cursor_external_id,
  last_successful_run_id,
  updated_at
) on public.sync_cursors to service_worker;
grant select, insert on table public.sync_pages to service_worker;
grant select, insert on table public.raw_amo_objects to service_worker;
grant select, insert on table public.raw_amo_events to service_worker;
grant select, insert on table public.raw_amo_quarantine to service_worker;
grant select, insert on table public.amo_api_audit to service_worker;

-- Deliberately no raw UPDATE/DELETE grant exists for service_worker or a user
-- role. The separately reviewed retention job owns the only future deletion
-- path and must first preserve hashes and normalized history.
