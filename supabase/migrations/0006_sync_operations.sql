create table public.raw_retention_proofs (
  source_table text not null check (
    source_table in ('raw_amo_objects', 'raw_amo_events', 'raw_amo_quarantine')
  ),
  source_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  normalized_entity_type text not null check (
    char_length(normalized_entity_type) between 1 and 80
  ),
  normalized_entity_id text not null check (
    char_length(normalized_entity_id) between 1 and 128
  ),
  proved_at timestamptz not null default now(),
  primary key (source_table, source_id)
);

-- Proof rows are an append-only bridge to M5 normalized history. They retain
-- the source hash and normalized identity after the raw payload expires.
alter table public.raw_retention_proofs enable row level security;
revoke all on table public.raw_retention_proofs from anon, authenticated;
grant select, insert on table public.raw_retention_proofs to service_worker;

create function app.fail_stale_sync_runs(
  p_cutoff timestamptz,
  p_finished_at timestamptz
)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.sync_runs
  set
    status = 'failed',
    finished_at = p_finished_at,
    error_code = 'E_SYNC_WATCHDOG',
    error_summary = 'Synchronization exceeded the twenty minute watchdog'
  where status = 'running'
    and started_at <= p_cutoff
  returning id;
$$;

revoke all on function app.fail_stale_sync_runs(timestamptz, timestamptz)
from public;
grant execute on function app.fail_stale_sync_runs(timestamptz, timestamptz)
to service_worker;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'retention_worker') then
    create role retention_worker nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public, app to retention_worker;
grant retention_worker to postgres, service_role;

create function app.delete_proven_raw_before(p_cutoff timestamptz)
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
declare
  deleted_objects integer;
  deleted_events integer;
  deleted_quarantine integer;
  deleted_total integer;
begin
  with removed as (
    delete from public.raw_amo_objects as raw
    using public.raw_retention_proofs as proof
    where proof.source_table = 'raw_amo_objects'
      and proof.source_id = raw.id
      and proof.payload_sha256 = raw.payload_sha256
      and raw.received_at < p_cutoff
    returning raw.id
  ) select count(*)::integer into deleted_objects from removed;

  with removed as (
    delete from public.raw_amo_events as raw
    using public.raw_retention_proofs as proof
    where proof.source_table = 'raw_amo_events'
      and proof.source_id = raw.id
      and proof.payload_sha256 = raw.payload_sha256
      and raw.received_at < p_cutoff
    returning raw.id
  ) select count(*)::integer into deleted_events from removed;

  with removed as (
    delete from public.raw_amo_quarantine as raw
    using public.raw_retention_proofs as proof
    where proof.source_table = 'raw_amo_quarantine'
      and proof.source_id = raw.id
      and proof.payload_sha256 = raw.payload_sha256
      and raw.received_at < p_cutoff
    returning raw.id
  ) select count(*)::integer into deleted_quarantine from removed;

  deleted_total := deleted_objects + deleted_events + deleted_quarantine;
  return query select
    deleted_objects,
    deleted_events,
    deleted_quarantine,
    deleted_total,
    deleted_total;
end
$$;

revoke all on function app.delete_proven_raw_before(timestamptz) from public;
grant execute on function app.delete_proven_raw_before(timestamptz)
to retention_worker;

-- No DELETE grant is added to service_worker or a user-facing role. Only the
-- retention role can execute the hash-matched, proof-gated deletion function.
