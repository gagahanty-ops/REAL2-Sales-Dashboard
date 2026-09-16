-- Task 6 fix round 3: keep stable queue correlation separate from the
-- per-attempt sync run trace so crash-reclaimed jobs can start new runs.
alter table public.sync_runs
  add column correlation_trace_id text check (
    correlation_trace_id is null
    or char_length(correlation_trace_id) between 1 and 80
  );

create index sync_runs_correlation_trace_idx
on public.sync_runs (correlation_trace_id)
where correlation_trace_id is not null;

grant insert (correlation_trace_id) on public.sync_runs to service_worker;
