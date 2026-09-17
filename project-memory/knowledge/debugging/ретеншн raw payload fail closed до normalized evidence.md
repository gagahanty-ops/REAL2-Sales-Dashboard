---
tags: [real2, debugging, retention, data-safety]
date: 2026-09-16
---

# Ретеншн raw payload fail closed до normalized evidence

## Проблема

В Task 6 review поймал риск: raw retention proof был синтетическим/непривязанным, а cutoff мог задаваться вызывающим кодом. Это могло удалить сырые данные до того, как нормализованный слой реально докажет сохранность.

## Решение

До Plan 3 retention должен fail closed и удалять zero raw rows, пока не сможет проверить конкретную normalized row и matching retained hash.

## Почему это важно

Raw payload - аудиторское зеркало amoCRM. Его нельзя преждевременно чистить, иначе пропадет evidence для reconciliation и расследования расхождений.

## Текущий статус

Task 6 финально оставил retention zero-delete/fail-closed до normalized evidence.

## Связанные заметки

- [[Task 6 завершил guarded sync recovery и Task 7 не начинался]]
- [[проект нельзя ломать в amoCRM и нельзя трогать исходную Google таблицу]]
