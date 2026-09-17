---
tags: [real2, architecture, atlas]
date: 2026-09-16
---

# Архитектура проекта REAL2 разделена на web worker db integrations domain testkit

## Назначение системы

REAL2 Sales Dashboard - закрытый дашборд отдела продаж. Он читает amoCRM, строит метрики по утвержденным формулам, показывает их в приватном веб-интерфейсе и позже сможет публиковать только в отдельную копию Google таблицы.

## Главные компоненты

- `apps/web` - Next.js UI, API routes, private admin/head/manager screens.
- `apps/worker` - scheduled sync, durable queue, normalization, snapshots, future Sheet publishing.
- `packages/domain` - Zod contracts, roles, dates, money, metrics, errors.
- `packages/db` - PostgreSQL repositories, transactions, RLS-facing data access.
- `packages/integrations` - guarded amoCRM and future Google clients.
- `packages/testkit` - synthetic fixtures, mock servers, golden data, scanners.
- `supabase/migrations` - ordered SQL migrations and RLS.
- `docs/superpowers/plans` - исполнимые планы разработки.

## Состояние миграций

На Task 6 есть migrations `0001`-`0009`:

- identity/access controls;
- amo OAuth;
- amo read check;
- configuration;
- raw sync journal;
- sync operations;
- sync hardening;
- sync queue worker;
- sync queue attempt correlation.

## Runtime principle

Внешние системы не вызываются напрямую из UI. Секреты остаются на сервере. amoCRM запросы проходят через единый guarded transport. Google Sheets publisher еще не должен писать никуда, кроме будущей явно разрешенной копии.

## Связанные заметки

- [[интеграция amoCRM только внешняя OAuth и только read-only]]
- [[исходная Google таблица навсегда защищена от записи]]
- [[проект идет по Spec First и изменения сначала сверяются со спецификацией]]
