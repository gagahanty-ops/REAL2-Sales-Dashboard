---
tags: [real2, deploy, operations, atlas]
date: 2026-09-17
---

# Деплой и production пока заблокированы до shadow acceptance

## Текущий статус

Production rollout не выполнен. Live amoCRM OAuth не устанавливался. Google Sheets API не использовался для записи. Система пока проверялась локально и на синтетике.

## Почему production нельзя включать сразу

Проект работает рядом с рабочей amoCRM и ручной Google таблицей отдела продаж. Владелец явно требует:

- ничего не сломать в amoCRM;
- не потерять техническую поддержку amoCRM;
- не трогать исходную Google таблицу;
- получить четкую и проверяемую автоматизацию.

## Production gates

Из master roadmap:

- Foundation gate.
- amoCRM safety gate.
- Metric gate.
- Dashboard gate.
- Publication gate.
- Production gate: 7-14 shadow days reconcile with manual report and owner approval.

## Kill switches

Есть два уровня включения для sync и Sheets:

- env switch;
- DB control switch.

Оба должны быть включены, иначе внешний sync/publish не стартует. По умолчанию они disabled.

## Связанные заметки

- [[проект нельзя ломать в amoCRM и нельзя трогать исходную Google таблицу]]
- [[исходная Google таблица навсегда защищена от записи]]
- [[2026-09-17 task 7 and github handoff]]
