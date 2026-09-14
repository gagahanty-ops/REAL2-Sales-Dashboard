create type public.channel_match_type as enum (
  'source_field_exact',
  'tag_exact',
  'integration_source_exact'
);

create table public.pipeline_configs (
  id uuid primary key default gen_random_uuid(),
  amo_connection_id uuid not null references public.amo_connections(id),
  pipeline_id bigint not null,
  pipeline_name text not null,
  application_status_id bigint not null,
  application_status_name text not null,
  won_status_id bigint not null,
  won_status_name text not null,
  check (application_status_id <> won_status_id),
  source_field_id bigint,
  timezone text not null default 'Europe/Moscow'
    check (timezone = 'Europe/Moscow'),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  confirmed_by uuid not null references public.app_users(id),
  confirmed_at timestamptz not null default now(),
  unique (amo_connection_id, version)
);

create unique index one_active_pipeline_config
on public.pipeline_configs (amo_connection_id)
where is_active;

create table public.channel_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.pipeline_configs(id),
  priority smallint not null check (priority between 1 and 1000),
  match_type public.channel_match_type not null,
  match_value text not null check (char_length(match_value) between 1 and 500),
  normalized_channel text not null check (normalized_channel in (
    'phone_uis', 'whatsapp', 'avito', 'instagram', 'site', 'telegram', 'max', 'unknown'
  )),
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (config_id, match_type, match_value),
  unique (config_id, priority)
);

create table public.config_validations (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.pipeline_configs(id),
  checked_at timestamptz not null default now(),
  pipeline_found boolean not null,
  application_status_found boolean not null,
  won_status_found boolean not null,
  source_field_found boolean not null,
  metadata_checksum text not null check (metadata_checksum ~ '^[a-f0-9]{64}$'),
  details jsonb not null default '{}'::jsonb
);

create index config_validations_latest_idx
on public.config_validations (config_id, checked_at desc);

create table public.config_recalculation_requests (
  config_id uuid primary key references public.pipeline_configs(id),
  requested_by uuid not null references public.app_users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'queued' check (status = 'queued')
);

create function public.prevent_pipeline_config_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.is_active
    and not new.is_active
    and new.amo_connection_id is not distinct from old.amo_connection_id
    and new.pipeline_id is not distinct from old.pipeline_id
    and new.pipeline_name is not distinct from old.pipeline_name
    and new.application_status_id is not distinct from old.application_status_id
    and new.application_status_name is not distinct from old.application_status_name
    and new.won_status_id is not distinct from old.won_status_id
    and new.won_status_name is not distinct from old.won_status_name
    and new.source_field_id is not distinct from old.source_field_id
    and new.timezone is not distinct from old.timezone
    and new.version is not distinct from old.version
    and new.confirmed_by is not distinct from old.confirmed_by
    and new.confirmed_at is not distinct from old.confirmed_at
  then
    return new;
  end if;

  raise exception 'Pipeline configuration versions are immutable'
    using errcode = 'P0001';
end;
$$;

create trigger pipeline_configs_immutable
before update or delete on public.pipeline_configs
for each row execute function public.prevent_pipeline_config_mutation();

create function public.prevent_config_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Configuration history is immutable' using errcode = 'P0001';
end;
$$;

create trigger channel_rules_immutable
before update or delete on public.channel_rules
for each row execute function public.prevent_config_history_mutation();

create trigger config_validations_immutable
before update or delete on public.config_validations
for each row execute function public.prevent_config_history_mutation();

alter table public.pipeline_configs enable row level security;
alter table public.channel_rules enable row level security;
alter table public.config_validations enable row level security;
alter table public.config_recalculation_requests enable row level security;

revoke all on table public.pipeline_configs from anon, authenticated;
revoke all on table public.channel_rules from anon, authenticated;
revoke all on table public.config_validations from anon, authenticated;
revoke all on table public.config_recalculation_requests from anon, authenticated;

grant select (
  id,
  pipeline_id,
  pipeline_name,
  application_status_id,
  application_status_name,
  won_status_id,
  won_status_name,
  source_field_id,
  timezone,
  version,
  is_active,
  confirmed_at
) on public.pipeline_configs to authenticated;

grant select (
  id,
  config_id,
  priority,
  match_type,
  match_value,
  normalized_channel,
  is_active,
  created_at
) on public.channel_rules to authenticated;

grant select (
  id,
  config_id,
  checked_at,
  pipeline_found,
  application_status_found,
  won_status_found,
  source_field_found,
  metadata_checksum,
  details
) on public.config_validations to authenticated;

create policy pipeline_configs_leadership_current_select
on public.pipeline_configs
for select
to authenticated
using (
  is_active
  and (select app.current_role()) in ('admin', 'head')
);

create policy channel_rules_leadership_current_select
on public.channel_rules
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  and exists (
    select 1
    from public.pipeline_configs
    where pipeline_configs.id = channel_rules.config_id
      and pipeline_configs.is_active
  )
);

create policy config_validations_leadership_current_select
on public.config_validations
for select
to authenticated
using (
  (select app.current_role()) in ('admin', 'head')
  and exists (
    select 1
    from public.pipeline_configs
    where pipeline_configs.id = config_validations.config_id
      and pipeline_configs.is_active
  )
);

grant select on public.pipeline_configs, public.channel_rules, public.config_validations
to service_worker;
grant select, update on public.config_recalculation_requests to service_worker;
