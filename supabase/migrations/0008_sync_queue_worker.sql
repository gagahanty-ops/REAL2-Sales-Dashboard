-- Task 6 fix round 2: durable queue ownership and restricted worker logins.
-- Operators must assign passwords/secrets outside migrations; the roles are
-- real logins so production workers do not connect as postgres and SET ROLE.
alter role service_worker login noinherit bypassrls;
alter role retention_worker login noinherit nobypassrls;

alter table public.sync_work_queue
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column last_error_code text check (
    last_error_code is null or char_length(last_error_code) between 1 and 80
  ),
  add column last_error_summary text check (
    last_error_summary is null or char_length(last_error_summary) <= 500
  ),
  add constraint sync_work_queue_lease_state_check check (
    (status = 'queued'
      and completed_at is null
      and lease_token is null
      and lease_expires_at is null)
    or
    (status = 'running'
      and claimed_at is not null
      and completed_at is null
      and lease_token is not null
      and lease_expires_at is not null)
    or
    (status in ('done', 'failed')
      and completed_at is not null
      and lease_token is not null)
  );

create index sync_work_queue_claim_idx
on public.sync_work_queue (status, requested_at, id);

grant update (
  claimed_at,
  completed_at,
  status,
  sync_run_id,
  attempt_count,
  lease_token,
  lease_expires_at,
  last_error_code,
  last_error_summary
) on public.sync_work_queue to service_worker;
