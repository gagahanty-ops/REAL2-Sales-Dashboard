-- Immutable metric snapshots and versioned sales plans (SPEC M6).
-- Numbered 0011 because migrations 0005-0010 are reviewed and immutable; the
-- plan's illustrative `0006` name would corrupt the ordered history.

create type public.plan_metric_key as enum (
  'leads_created', 'applications', 'payments', 'revenue'
);

create table public.sales_plans (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  manager_key text not null check (char_length(manager_key) between 1 and 40),
  metric_key public.plan_metric_key not null,
  target_value numeric(14,2) not null check (target_value > 0),
  version integer not null check (version > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (month, manager_key, metric_key, version),
  check (valid_to is null or valid_to > valid_from)
);

create unique index sales_plans_one_current_idx
  on public.sales_plans (month, manager_key, metric_key)
  where valid_to is null;

create type public.snapshot_status as enum (
  'candidate', 'approved', 'published', 'rejected'
);

create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  version bigint generated always as identity unique,
  sync_run_id uuid not null references public.sync_runs(id),
  config_id uuid not null references public.pipeline_configs(id),
  status public.snapshot_status not null default 'candidate',
  generated_at timestamptz not null default now(),
  source_fresh_at timestamptz not null,
  approved_at timestamptz,
  published_at timestamptz,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  quality_summary jsonb not null,
  rejection_code text check (
    rejection_code is null or char_length(rejection_code) between 1 and 80
  ),
  unique (sync_run_id, config_id)
);

create table public.metric_cells (
  snapshot_id uuid not null references public.metric_snapshots(id),
  report_date date not null,
  manager_key text not null,
  channel_key text not null,
  leads_created integer not null check (leads_created >= 0),
  applications integer not null check (applications >= 0),
  payments integer not null check (payments >= 0),
  revenue numeric(14,2) not null check (revenue >= 0),
  primary key (snapshot_id, report_date, manager_key, channel_key)
);

create table public.metric_lead_facts (
  snapshot_id uuid not null references public.metric_snapshots(id),
  account_id bigint not null,
  amo_lead_id bigint not null,
  display_name text not null,
  report_date date not null,
  manager_key text not null,
  manager_name text not null,
  channel_key text not null,
  current_status_id bigint not null,
  price_rub numeric(14,2),
  application_at timestamptz,
  won_at timestamptz,
  currently_won boolean not null,
  amo_url text not null,
  quality_codes text[] not null default '{}',
  primary key (snapshot_id, account_id, amo_lead_id)
);

create index metric_lead_facts_drilldown_idx
  on public.metric_lead_facts (
    snapshot_id, report_date, manager_key, channel_key, amo_lead_id
  );

create table public.stage_snapshot_rows (
  snapshot_id uuid not null references public.metric_snapshots(id),
  status_id bigint not null,
  status_name text not null,
  manager_key text not null,
  open_count integer not null check (open_count >= 0),
  open_amount numeric(14,2) not null check (open_amount >= 0),
  median_age_seconds bigint check (median_age_seconds is null or median_age_seconds >= 0),
  average_age_seconds bigint check (average_age_seconds is null or average_age_seconds >= 0),
  primary key (snapshot_id, status_id, manager_key)
);

create table public.current_snapshot (
  singleton boolean primary key default true check (singleton),
  snapshot_id uuid not null references public.metric_snapshots(id),
  updated_at timestamptz not null default now()
);

-- A snapshot's content is evidence: rows may be written once and never edited.
-- Only the snapshot header moves through its status lifecycle, and only in the
-- direction the approval transaction allows.
create function public.prevent_snapshot_content_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Snapshot content is immutable' using errcode = 'P0001';
end;
$$;

create trigger metric_cells_immutable
before update or delete on public.metric_cells
for each row execute function public.prevent_snapshot_content_mutation();

create trigger metric_lead_facts_immutable
before update or delete on public.metric_lead_facts
for each row execute function public.prevent_snapshot_content_mutation();

create trigger stage_snapshot_rows_immutable
before update or delete on public.stage_snapshot_rows
for each row execute function public.prevent_snapshot_content_mutation();

create function public.enforce_snapshot_header_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Snapshots are never deleted' using errcode = 'P0001';
  end if;

  if
    new.id is distinct from old.id
    or new.version is distinct from old.version
    or new.sync_run_id is distinct from old.sync_run_id
    or new.config_id is distinct from old.config_id
    or new.generated_at is distinct from old.generated_at
    or new.source_fresh_at is distinct from old.source_fresh_at
    or new.checksum is distinct from old.checksum
    or new.quality_summary is distinct from old.quality_summary
  then
    raise exception 'Snapshot evidence is immutable' using errcode = 'P0001';
  end if;

  if old.status = 'candidate' and new.status in ('approved', 'rejected') then
    return new;
  end if;
  if old.status = 'approved' and new.status = 'published' then
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;

  raise exception 'Unsupported snapshot status transition'
    using errcode = 'P0001';
end;
$$;

create trigger metric_snapshots_lifecycle
before update or delete on public.metric_snapshots
for each row execute function public.enforce_snapshot_header_transition();

-- Plan rows are versioned history: a new target closes the previous row and
-- never overwrites it.
create function public.prevent_sales_plan_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sales plan history is immutable' using errcode = 'P0001';
  end if;

  if
    new.id is distinct from old.id
    or new.month is distinct from old.month
    or new.manager_key is distinct from old.manager_key
    or new.metric_key is distinct from old.metric_key
    or new.target_value is distinct from old.target_value
    or new.version is distinct from old.version
    or new.valid_from is distinct from old.valid_from
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Sales plan history is immutable' using errcode = 'P0001';
  end if;

  if old.valid_to is not null then
    raise exception 'Sales plan history is immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger sales_plans_versioned
before update or delete on public.sales_plans
for each row execute function public.prevent_sales_plan_rewrite();

alter table public.sales_plans enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.metric_cells enable row level security;
alter table public.metric_lead_facts enable row level security;
alter table public.stage_snapshot_rows enable row level security;
alter table public.current_snapshot enable row level security;

revoke all on table public.sales_plans, public.metric_snapshots,
  public.metric_cells, public.metric_lead_facts, public.stage_snapshot_rows,
  public.current_snapshot from anon, authenticated;

grant select on table public.sales_plans, public.metric_snapshots,
  public.metric_cells, public.metric_lead_facts, public.stage_snapshot_rows,
  public.current_snapshot to authenticated;

create policy sales_plans_leadership_select
on public.sales_plans
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or manager_key = (
    select coalesce(amo_user_id::text, 'unassigned')
    from public.app_users
    where auth_user_id = auth.uid() and is_active
    limit 1
  )
);

create policy metric_snapshots_leadership_select
on public.metric_snapshots
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy metric_cells_leadership_select
on public.metric_cells
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy stage_snapshot_rows_leadership_select
on public.stage_snapshot_rows
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy current_snapshot_leadership_select
on public.current_snapshot
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

-- A manager sees only the lead facts they are responsible for; leadership sees
-- every fact (SPEC M5.2 RLS invariants).
create policy metric_lead_facts_leadership_or_assigned_select
on public.metric_lead_facts
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or manager_key = (
    select coalesce(amo_user_id::text, 'unassigned')
    from public.app_users
    where auth_user_id = auth.uid() and is_active
    limit 1
  )
);

grant select, insert on table public.metric_snapshots, public.metric_cells,
  public.metric_lead_facts, public.stage_snapshot_rows to service_worker;
grant update (status, approved_at, published_at, rejection_code)
  on public.metric_snapshots to service_worker;
grant select, insert, update on table public.current_snapshot to service_worker;
grant select on table public.sales_plans to service_worker;
