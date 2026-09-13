# Локальная разработка REAL2

Этот запуск изолирован от рабочих amoCRM и Google Sheets. В проекте нет их
ключей, а `SYNC_ENABLED` и `SHEET_PUBLISH_ENABLED` в Compose жёстко равны
`false`.

## Требования

- Node.js `22.23.2`;
- pnpm `10.34.5`;
- Docker Engine и Docker Compose v2;
- Supabase CLI `2.117.0`;
- не менее 10 ГБ свободного места перед первой сборкой Docker-образов;
- свободные локальные порты `3000`, `54321` и `54322`.

Версии Node и pnpm уже закреплены в `.nvmrc` и `package.json`. Не копируйте в
чат или тикеты полный вывод `supabase status`, `docker inspect` либо Compose с
настоящими переменными: в нём могут быть локальные ключи.

## Первый запуск

1. Установите зависимости:

   ```bash
   corepack enable
   corepack prepare pnpm@10.34.5 --activate
   pnpm install --frozen-lockfile
   ```

2. Запустите локальный Supabase и примените миграции:

   ```bash
   supabase start
   supabase db reset
   ```

   Публичная регистрация отключена. API и Auth нужны только для локальной
   проверки закрытого входа; Studio, Storage, Realtime и Analytics отключены.

3. Создайте неотслеживаемый `.env.local` из `.env.example`. Для процессов на
   хосте используйте URL из локального Supabase, не контейнерный адрес. Замените
   только локальные `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY`; не
   вставляйте production-ключи. Ограничьте доступ к файлу:

   ```bash
   cp .env.example .env.local
   chmod 600 .env.local
   ```

4. Один раз создайте первого администратора. Команда откажется работать, если
   активный admin уже существует:

   ```bash
   set -a
   . ./.env.local
   set +a
   pnpm bootstrap:admin
   ```

5. В том же терминале запустите web и worker для разработки:

   ```bash
   pnpm dev
   ```

Worker на этом этапе делает только безопасный idle-проход. Он не обращается к
amoCRM или Google.

## Docker Compose

Compose всегда использует `host.docker.internal` для локального Supabase на
хосте, публикует web только на `127.0.0.1` и не содержит настоящих секретов.
Не передавайте ему `.env.local`: адрес `127.0.0.1` из этого файла внутри
контейнера укажет на сам контейнер. Вместо этого создайте отдельный
неотслеживаемый файл и замените в нём только два локальных ключа Supabase:

```bash
cp .env.compose.example .env.compose.local
chmod 600 .env.compose.local
```

Перед первой сборкой убедитесь, что на диске достаточно места (`df -h`). Затем
запускайте Compose с этим файлом явно:

```bash
docker compose --env-file .env.compose.local config --quiet
docker compose --env-file .env.compose.local build web
docker compose --env-file .env.compose.local --profile worker build worker
docker compose --env-file .env.compose.local up --wait web
curl --fail-with-body http://127.0.0.1:3000/api/health/live
docker compose --env-file .env.compose.local --profile worker run --rm worker
docker compose --env-file .env.compose.local --profile worker down --remove-orphans
```

Worker — одноразовая job с `restart: "no"`. Расписание появится только вместе с
реальной read-only синхронизацией. `/api/health/live` подтверждает жизнь
процесса, но намеренно не проверяет БД и внешние системы.

## Проверки перед изменениями

```bash
pnpm check:secrets
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:integration
pnpm test:security
supabase db lint
pnpm build
docker compose config --quiet
```

## Остановка и аварийное состояние

```bash
docker compose --profile worker down --remove-orphans
supabase stop --no-backup
```

При любом подозрении на ошибку сначала оставьте оба сетевых флага равными
`false`, затем остановите worker. Их включение не является локальной операцией и
потребует отдельного staging-gate.

## Production-граница

Перед production нужны HTTPS reverse proxy, точный `APP_URL`, управляемый
Supabase/PostgreSQL без автопаузы, secret store и проверенное резервное
копирование. Секреты не передаются через Docker build arguments и не хранятся в
репозитории. Исходная Google-таблица никогда не получает права service account;
запись позже будет разрешена только в утверждённую копию.
