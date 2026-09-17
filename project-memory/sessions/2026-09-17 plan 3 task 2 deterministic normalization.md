---
tags: [real2, session, plan-3, task-2, handoff]
date: 2026-09-17
---

# Plan 3 Task 2 — детерминированная нормализация (машина ishop)

## Старт

- Репозиторий склонирован с GitHub на новую машину.
- Контрольная точка сошлась: ветка `feat/foundation-access`, HEAD `2f50f23`, чистое дерево, local = tracking = remote.
- Node 22 взята из официального tarball (`~/.local/node22/bin`): brew не смог её поставить.
- Первый клон лежал на iCloud-рабочем столе при почти полном диске. macOS выгружала файлы (`dataless`), поэтому eslint и модули падали случайно. Рабочая копия пересоздана как `~/Desktop/REAL2-Sales-Dashboard.nosync`, а старый путь заменён симлинком. В старом клоне не было уникальной работы.
- Место на диске освобождалось только за счёт кэшей: npm, pip, Homebrew, скачанные обновления Dolphin и GeeLark.

## Сделано

- Brief с решениями R1–R11, red → green, мутационная проверка (8 + 3 мутации пойманы).
- Модули: `moscow-date`, `rubles`, `channel`, `normalize-lead`, `lead-builders`; добавлен `fast-check`.
- Независимое ревью:
  - первый проход: spec APPROVED, quality CHANGES REQUIRED (2×P2, 7×P3);
  - fix round 1 (`0072eff`) и fix round 2 (`4c46499`);
  - итог: APPROVED/APPROVED.
- Шаги 1–5 Task 2 в плане отмечены после свежего прогона Step 4.

## Проверки

- Прошли: lint, typecheck, build, contracts, secret scan, diff check, repo/worker 16/16.
- unit 317/333: 16 падений — DB-зависимый `oauth.test.ts`, как и в нетронутом baseline.
- integration 12/86 и security 5/24: остальное требует БД.
- `supabase db reset` невозможен: нет Docker и Supabase CLI. brew требует обновить CLT через sudo; свободно около 2 ГБ диска, swap исчерпан.

## Точка продолжения

- Прогнать полный gate на машине с локальным Supabase.
- Если он зелёный — Plan 3 Task 3.
- Handoff notes для Task 3/4 — в `raw-context/sdd/2026-09-12-03-normalization-metrics/progress.md`.

## Безопасность

- Внешних вызовов amoCRM и Google не было.
- Switches выключены, `.env` на машине нет.
- Исходная таблица не затрагивалась.
- В фикстурах только синтетические данные: телефоны с кодом `000`.
