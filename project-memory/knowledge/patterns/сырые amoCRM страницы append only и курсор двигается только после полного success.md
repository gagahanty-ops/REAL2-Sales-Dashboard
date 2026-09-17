---
tags: [real2, pattern, sync, data-integrity]
date: 2026-09-16
---

# Сырые amoCRM страницы append only и курсор двигается только после полного success

## Паттерн

Raw sync сохраняет страницы amoCRM append-only, с checksum и привязкой к sync run. Cursor advances only after a complete successful run.

## Что нельзя

- нельзя перезаписывать raw pages обычной app/service role;
- нельзя двигать cursor после partial/failed sync;
- нельзя silently discard malformed/unknown data;
- нельзя считать partial run источником production snapshot.

## Зачем

Это позволяет:

- повторно проверять данные;
- расследовать расхождения;
- безопасно переживать crash/retry;
- доказывать, что dashboard не строится на неполном источнике.

## Связанные документы

- `raw-context/project-docs/SPEC.md`, M4.
- `raw-context/sdd/2026-09-12-02-amo-readonly-sync/task-5-report.md`.
- `raw-context/sdd/2026-09-12-02-amo-readonly-sync/task-6-report.md`.
