create type public.connection_status as enum (
  'pending',
  'active',
  'reauth_required',
  'disabled'
);

create table public.oauth_states (
  state_hash text primary key,
  created_by uuid not null references public.app_users(id),
  redirect_after text not null default '/settings/integrations',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.amo_connections (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null unique,
  subdomain text not null unique check (subdomain ~ '^[a-z0-9-]+$'),
  base_url text not null check (base_url = 'https://555151.amocrm.ru'),
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expires_at timestamptz not null,
  status public.connection_status not null,
  installed_by uuid not null references public.app_users(id),
  installed_at timestamptz not null default now(),
  refreshed_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index amo_connections_refresh_due_idx
on public.amo_connections (token_expires_at)
where status = 'active';

alter table public.oauth_states enable row level security;
alter table public.amo_connections enable row level security;

revoke all on table public.oauth_states from anon, authenticated;
revoke all on table public.amo_connections from anon, authenticated;

grant select (
  id,
  account_id,
  subdomain,
  base_url,
  token_expires_at,
  status,
  installed_by,
  installed_at,
  refreshed_at,
  disabled_at,
  updated_at
) on public.amo_connections to authenticated;

create policy amo_connections_admin_status_select
on public.amo_connections
for select
to authenticated
using ((select app.current_role()) = 'admin');

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_worker') then
    create role service_worker nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to service_worker;
grant select, insert, update, delete
on public.oauth_states, public.amo_connections
to service_worker;

grant service_worker to postgres, service_role;
