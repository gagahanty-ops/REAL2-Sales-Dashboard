---
tags: [real2, amoCRM, oauth, read-only, integration]
date: 2026-09-17
---

# Интеграция amoCRM только внешняя OAuth и только read-only

## Жесткое правило

Используется только внешняя OAuth-интеграция amoCRM. Приватная интеграция запрещена, потому что она может привести к потере технической поддержки amoCRM.

## Разрешенные amoCRM запросы

Business API:

- только `GET`;
- только точный host `555151.amocrm.ru`;
- только allowlisted paths.

OAuth:

- единственный разрешенный `POST` - `/oauth2/access_token`.

Запрещены:

- `PATCH`;
- `PUT`;
- `DELETE`;
- business `POST`;
- generic proxy;
- прямые browser requests с токеном;
- логирование token/code/body/query values.

## Текущая реализация

Task 1-7 построили guarded transport, encrypted OAuth, admin OAuth routes, configuration discovery, raw sync journal, guarded sync worker, статические safety-gates и operational runbooks.

Последняя точка: commit `d9226b0`.

## Следующий шаг

Plan 2 закрыт. Следующий шаг — Plan 3 normalization/metrics; safety-gates Plan 2 нельзя ослаблять.

## Источник истины

- `raw-context/project-docs/SECURITY_READ_ONLY.md`
- `raw-context/project-docs/docs/superpowers/plans/2026-09-12-02-amo-readonly-sync.md`
- `raw-context/sdd/2026-09-12-02-amo-readonly-sync/progress.md`
