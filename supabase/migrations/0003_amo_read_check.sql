alter table public.amo_connections
  add column last_checked_at timestamptz;

grant select (last_checked_at) on public.amo_connections to authenticated;
