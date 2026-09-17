---
tags: [real2, pattern, integrations, safety]
date: 2026-09-16
---

# Внешние интеграции должны иметь двойной switch и fail closed поведение

## Паттерн

Каждая внешняя интеграция, которая может вызвать side effect или live network activity, должна проверять:

- environment switch;
- database control switch.

Оба должны быть enabled. Если один выключен, система должна остановиться до token lookup, DB lock и network call, когда это применимо.

## Где используется

- amoCRM sync: `SYNC_ENABLED` + DB `sync_enabled`.
- Google Sheets publish: `SHEET_PUBLISH_ENABLED` + DB `sheet_publish_enabled`.

## Почему

Одного env flag недостаточно: можно ошибиться при deploy. Одного DB flag тоже недостаточно: можно ошибиться в admin UI. Двойной switch снижает риск случайного live запуска.

## Как проверять

Тесты должны доказывать, что disabled path не делает live external request и не читает токены без необходимости.
