-- Plan 3 normalized history is not present yet. Retention therefore fails
-- closed: no raw evidence is deleted merely because a worker supplied a claim.
create or replace function app.delete_proven_raw_before(p_cutoff timestamptz)
returns table (
  objects_deleted integer,
  events_deleted integer,
  quarantine_deleted integer,
  hashes_preserved integer,
  normalized_rows_verified integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_cutoff > now() - interval '90 days' then
    raise exception 'raw retention cutoff must be at least ninety days old'
      using errcode = '22023';
  end if;
  -- A later migration may replace this only with a same-transaction join to a
  -- concrete normalized relation that retains the exact payload hash.
  return query select 0, 0, 0, 0, 0;
end
$$;

revoke all on table public.raw_retention_proofs from service_worker;
revoke all on function app.delete_proven_raw_before(timestamptz) from public;
revoke retention_worker from postgres, service_role;
alter role retention_worker nologin noinherit nobypassrls;

create table public.sync_work_queue (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique check (char_length(trace_id) between 1 and 80),
  kind public.sync_kind not null,
  requested_by uuid references public.app_users(id),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- Kept as an immutable diagnostic reference without a foreign key so the
  -- append-only journal can be independently retained/restored.
  sync_run_id uuid
);
alter table public.sync_work_queue enable row level security;
revoke all on table public.sync_work_queue from anon, authenticated;
grant select, insert on public.sync_work_queue to service_worker;
grant select on public.sync_work_queue to authenticated;

create table public.sync_critical_alerts (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null,
  code text not null,
  summary text not null check (char_length(summary) <= 500),
  created_at timestamptz not null default now(),
  unique (sync_run_id, code)
);
alter table public.sync_critical_alerts enable row level security;
revoke all on table public.sync_critical_alerts from anon, authenticated;
grant select, insert on public.sync_critical_alerts to service_worker;
grant select on public.sync_critical_alerts to authenticated;
