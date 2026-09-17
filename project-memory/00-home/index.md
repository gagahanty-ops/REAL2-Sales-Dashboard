---
tags: [real2, home, onboarding, memory-vault]
date: 2026-09-17
---

# REAL2 Project Memory Vault

Это переносимая память проекта [[REAL2 дашборд отдела продаж строится как read-only зеркало amoCRM]]. Ее цель - чтобы другой агент открыл эту папку, за 2-5 минут понял проект и продолжил работу без повторного расспроса владельца.

## Быстрый старт для нового агента

1. Прочитай [[текущие приоритеты и точка продолжения]].
2. Прочитай [[архитектура проекта REAL2 разделена на web worker db integrations domain testkit]].
3. Прочитай [[интеграция amoCRM только внешняя OAuth и только read-only]] и [[исходная Google таблица навсегда защищена от записи]].
4. Перед кодом открой `raw-context/project-docs/SPEC.md`, `raw-context/project-docs/METRICS_CATALOG.md`, `raw-context/project-docs/SECURITY_READ_ONLY.md`.
5. Для продолжения разработки открой `raw-context/project-docs/docs/superpowers/plans/2026-09-12-03-normalization-metrics.md`; закрытие Plan 2 подтверждено в `raw-context/sdd/2026-09-12-02-amo-readonly-sync/progress.md`.

## Карта vault

- [[текущие приоритеты и точка продолжения]] - где проект остановлен и что делать дальше.
- [[проект нельзя ломать в amoCRM и нельзя трогать исходную Google таблицу]] - главные запреты владельца.
- [[REAL2 дашборд отдела продаж строится как read-only зеркало amoCRM]] - бизнес-контекст.
- [[архитектура проекта REAL2 разделена на web worker db integrations domain testkit]] - техническая карта.
- [[интеграция amoCRM только внешняя OAuth и только read-only]] - amoCRM/OAuth.
- [[исходная Google таблица навсегда защищена от записи]] - Google Sheets boundary.
- [[метрики считаются по дате создания лида в Москве]] - метрики и спорная бизнес-логика.
- [[2026-09-17 plan 3 task 2 deterministic normalization]] - последняя сессия: Task 2 одобрена ревью, DB-gate ждёт машину с Supabase.
- [[2026-09-17 task 7 and github handoff]] - сессия закрытия Plan 2.
- [[проект идет по Spec First и изменения сначала сверяются со спецификацией]] - рабочий метод.
- [[как продолжить проект новому агенту]] - конкретная инструкция продолжения.

## Raw context

Папка `raw-context/` содержит первичные материалы, которые не надо пересказывать по памяти:

- `raw-context/project-docs/` - копии ключевых документов проекта.
- `raw-context/project-docs/docs/superpowers/plans/` - все исполнимые планы.
- `raw-context/sdd/` - SDD ledger, task briefs, reports и review diffs.
- `raw-context/guide/Obsidian_ClaudeCode_Guide.pdf` - гайд, по которому построен этот vault.

## Важное предупреждение

Память встроена в рабочий репозиторий как `project-memory/`. Код и вся актуальная память теперь передаются одним GitHub-репозиторием; вложенного Git-репозитория, snapshot или bundle внутри нет.
