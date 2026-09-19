-- Synthetic backup fixture for the restore rehearsal. It contains only the
-- structures the rehearsal checks and no real data of any kind.
create table if not exists system_controls (
  key text primary key,
  enabled boolean not null default false,
  reason text not null default 'восстановлено из резервной копии'
);

insert into system_controls (key, enabled) values
  ('sync_enabled', false),
  ('sheet_publish_enabled', false)
on conflict (key) do nothing;

create table if not exists metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  checksum text not null
);

insert into metric_snapshots (checksum)
values (repeat('a', 64))
on conflict do nothing;
