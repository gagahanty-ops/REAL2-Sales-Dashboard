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

## Блокеры

1. Нет Docker/Supabase — DB-часть gate не выполнена.
2. Нет прав push: аккаунт `gagahanty-ops` имеет только чтение. Коммиты лежат локально и в бандле `~/Desktop/REAL2-task2.bundle`.

## Попытка поднять локальную БД (вечер того же дня)

Установлено вручную, минуя brew (brew блокирован устаревшими Xcode CLT):

- Supabase CLI `2.117.0` → `~/.local/bin/supabase`;
- docker CLI `29.8.1` → `~/.local/bin/docker`;
- colima `0.10.3` → `~/.local/bin/colima`;
- lima `2.2.0` → `~/.local/lima/bin`.

Движок Docker поднять не удалось. `colima start` сначала не смог скачать образ (таймаут сети), затем при повторной попытке распаковка образа и ресайз диска VM съели последние гигабайты: диск заполнился на 100%, и оболочка перестала работать вообще (`ENOSPC` при создании файла вывода). Данные colima (`~/.colima`, `~/.lima`, `~/Library/Caches/colima`) удалены, вернулось около 3.2 ГБ.

Урок: `docs/runbooks/local-development.md` уже требует **не менее 10 ГБ** свободного места перед первым запуском образов. Это требование надо проверять ДО `colima start` или `supabase start`, а не после.

После инцидента проверено: `git fsck` без ошибок, дерево чистое, 5 коммитов на месте, бандл валиден, domain-тесты 242/242.

## Гейт с базой пройден (2026-09-19)

После освобождения диска до 12 ГБ Docker-движок и Supabase поднялись штатно. Все 16 ранее падавших тестов оказались зелёными без правок кода — им не хватало только живой базы. Итог: integration 86/86, security 24/24, `pnpm test` 333/333, `supabase db lint` чисто.

## Безопасность

- Внешних вызовов amoCRM и Google не было.
- Switches выключены, `.env` на машине нет.
- Исходная таблица не затрагивалась.
- В фикстурах только синтетические данные: телефоны с кодом `000`.
