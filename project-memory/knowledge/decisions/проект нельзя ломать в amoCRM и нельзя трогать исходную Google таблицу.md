---
tags: [real2, decision, safety, non-negotiable]
date: 2026-09-16
---

# Проект нельзя ломать в amoCRM и нельзя трогать исходную Google таблицу

## Решение

Проект строится с fail-closed безопасностью:

- amoCRM - только read-only business API;
- Google Sheets - только будущая копия, исходный spreadsheet ID защищен denylist;
- production switches по умолчанию выключены;
- реальные секреты и live credentials не вводятся без отдельного этапа;
- private amoCRM integration запрещена.

## Причина

Владелец проекта прямо сказал:

- "НИЧЕГО не поломалось в АМО срм";
- "чтобы все работало четко";
- "чтоб мы не лишились техподдержки от амо";
- "саму таблицу которую я скинул пока не трогай".

## Практическое следствие

Любая разработка должна сначала доказать отсутствие опасного действия тестом или runtime guard. Если есть сомнение, поведение должно блокироваться, а не продолжаться.

## Связанные документы

- `raw-context/project-docs/SECURITY_READ_ONLY.md`
- `raw-context/project-docs/SPEC.md`
- `raw-context/project-docs/CLAUDE.md`
