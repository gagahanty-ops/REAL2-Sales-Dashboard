---
tags: [real2, google-sheets, protected-source, integration]
date: 2026-09-16
---

# Исходная Google таблица навсегда защищена от записи

## Protected spreadsheet

Исходная ручная таблица:

```text
123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks
```

Владелец прямо запретил редактировать ее. Можно создать дубликат/копию, но исходник не трогать.

## Техническое правило

`PROTECTED_SPREADSHEET_IDS` должен содержать этот ID. Любая запись в совпадающий spreadsheet должна падать до вызова Google API с `E_SHEET_PROTECTED`.

## Production writer

Будущий writer должен:

- принимать ровно один разрешенный `GOOGLE_TARGET_SPREADSHEET_ID`;
- иметь доступ только к копии;
- проверять layout fingerprint;
- писать атомарно через staging/temp range;
- публиковать только approved snapshot;
- не менять исходную таблицу ни при каких credentials.

## Текущее состояние

Публикация в Google Sheets еще не реализована как production feature. До Plan 5 любые Google Sheets записи запрещены.

## Источник истины

`raw-context/project-docs/SECURITY_READ_ONLY.md`, раздел 5.
