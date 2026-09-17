create table public.amo_users (
  account_id bigint not null,
  amo_user_id bigint not null,
  name text not null,
  email extensions.citext,
  is_active boolean not null,
  source_updated_at timestamptz,
  normalized_at timestamptz not null default now(),
  primary key (account_id, amo_user_id)
);

create table public.pipeline_statuses (
  account_id bigint not null,
  pipeline_id bigint not null,
  status_id bigint not null,
  name text not null,
  sort_order integer not null,
  is_closed boolean not null,
  is_won boolean not null,
  source_updated_at timestamptz,
  primary key (account_id, status_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint not null,
  pipeline_id bigint not null,
  current_status_id bigint not null,
  current_responsible_user_id bigint,
  name text not null,
  price_rub numeric(14,2),
  created_at timestamptz not null,
  created_date date not null,
  source_updated_at timestamptz not null,
  normalized_channel text not null,
  channel_rule_id uuid references public.channel_rules(id),
  normalization_config_id uuid not null references public.pipeline_configs(id),
  amo_url text not null,
  is_deleted boolean not null default false,
  normalized_at timestamptz not null default now(),
  unique (account_id, amo_lead_id)
);

create table public.lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id text not null,
  amo_lead_id bigint not null,
  from_status_id bigint,
  to_status_id bigint not null,
  responsible_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references public.leads(account_id, amo_lead_id)
);

create table public.lead_responsible_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id text not null,
  amo_lead_id bigint not null,
  from_user_id bigint,
  to_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references public.leads(account_id, amo_lead_id)
);

create table public.lead_milestones (
  account_id bigint not null,
  amo_lead_id bigint not null,
  application_at timestamptz,
  application_responsible_user_id bigint,
  won_at timestamptz,
  won_responsible_user_id bigint,
  currently_won boolean not null default false,
  recalculated_at timestamptz not null default now(),
  primary key (account_id, amo_lead_id),
  foreign key (account_id, amo_lead_id) references public.leads(account_id, amo_lead_id)
);

create type public.quality_severity as enum ('info', 'warning', 'blocking');
create type public.quality_status as enum ('open', 'resolved', 'accepted');

create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint,
  sync_run_id uuid references public.sync_runs(id),
  code text not null,
  severity public.quality_severity not null,
  status public.quality_status not null default 'open',
  safe_details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index data_quality_one_open_issue_idx
  on public.data_quality_issues (account_id, coalesce(amo_lead_id, 0), code)
  where status = 'open';

create index leads_created_idx on public.leads(created_date);
create index leads_manager_date_idx on public.leads(current_responsible_user_id, created_date);
create index leads_channel_date_idx on public.leads(normalized_channel, created_date);
create index lead_stage_timeline_idx
  on public.lead_stage_events(amo_lead_id, occurred_at, amo_event_id);
create index quality_status_idx on public.data_quality_issues(status, severity, code);

alter table public.amo_users enable row level security;
alter table public.pipeline_statuses enable row level security;
alter table public.leads enable row level security;
alter table public.lead_stage_events enable row level security;
alter table public.lead_responsible_events enable row level security;
alter table public.lead_milestones enable row level security;
alter table public.data_quality_issues enable row level security;

revoke all on table public.amo_users from anon, authenticated;
revoke all on table public.pipeline_statuses from anon, authenticated;
revoke all on table public.leads from anon, authenticated;
revoke all on table public.lead_stage_events from anon, authenticated;
revoke all on table public.lead_responsible_events from anon, authenticated;
revoke all on table public.lead_milestones from anon, authenticated;
revoke all on table public.data_quality_issues from anon, authenticated;

grant select on table public.amo_users, public.pipeline_statuses, public.leads,
  public.lead_stage_events, public.lead_responsible_events, public.lead_milestones,
  public.data_quality_issues to authenticated;

create policy amo_users_leadership_select
on public.amo_users
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy pipeline_statuses_leadership_select
on public.pipeline_statuses
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

create policy leads_leadership_or_assigned_select
on public.leads
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or current_responsible_user_id = (
    select amo_user_id
    from public.app_users
    where auth_user_id = auth.uid()
      and is_active
    limit 1
  )
);

create policy lead_stage_events_leadership_or_assigned_select
on public.lead_stage_events
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or exists (
    select 1
    from public.leads
    where leads.account_id = lead_stage_events.account_id
      and leads.amo_lead_id = lead_stage_events.amo_lead_id
      and leads.current_responsible_user_id = (
        select amo_user_id
        from public.app_users
        where auth_user_id = auth.uid()
          and is_active
        limit 1
      )
  )
);

create policy lead_responsible_events_leadership_or_assigned_select
on public.lead_responsible_events
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or exists (
    select 1
    from public.leads
    where leads.account_id = lead_responsible_events.account_id
      and leads.amo_lead_id = lead_responsible_events.amo_lead_id
      and leads.current_responsible_user_id = (
        select amo_user_id
        from public.app_users
        where auth_user_id = auth.uid()
          and is_active
        limit 1
      )
  )
);

create policy lead_milestones_leadership_or_assigned_select
on public.lead_milestones
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  or exists (
    select 1
    from public.leads
    where leads.account_id = lead_milestones.account_id
      and leads.amo_lead_id = lead_milestones.amo_lead_id
      and leads.current_responsible_user_id = (
        select amo_user_id
        from public.app_users
        where auth_user_id = auth.uid()
          and is_active
        limit 1
      )
  )
);

create policy data_quality_issues_leadership_select
on public.data_quality_issues
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));

grant select, insert, update on table public.amo_users, public.pipeline_statuses,
  public.leads, public.lead_stage_events, public.lead_responsible_events,
  public.lead_milestones, public.data_quality_issues to service_worker;
