create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.app_role as enum ('admin', 'head', 'manager');

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  email extensions.citext not null unique,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role public.app_role not null,
  amo_user_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'manager' and amo_user_id is not null) or role <> 'manager')
);

create index app_users_amo_user_idx on public.app_users (amo_user_id)
where amo_user_id is not null;

create table public.system_controls (
  key text primary key check (key in ('sync_enabled', 'sheet_publish_enabled')),
  enabled boolean not null default false,
  reason text not null check (btrim(reason) <> ''),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

insert into public.system_controls (key, enabled, reason) values
  ('sync_enabled', false, 'disabled until staging safety gate'),
  ('sheet_publish_enabled', false, 'disabled until shadow acceptance');

create schema app;
revoke all on schema app from public;

create function app.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.app_users
  where auth_user_id = auth.uid()
    and is_active
  limit 1;
$$;

revoke all on function app.current_role() from public;
grant usage on schema app to authenticated;
grant execute on function app.current_role() to authenticated;

alter table public.app_users enable row level security;
alter table public.system_controls enable row level security;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.system_controls from anon, authenticated;
grant select on table public.app_users to authenticated;
grant select on table public.system_controls to authenticated;

create policy app_users_self_or_leadership_select
on public.app_users
for select
to authenticated
using (
  (auth_user_id = (select auth.uid()) and is_active)
  or (select app.current_role()) in ('admin', 'head')
);

create policy controls_leadership_select
on public.system_controls
for select
to authenticated
using ((select app.current_role()) in ('admin', 'head'));
