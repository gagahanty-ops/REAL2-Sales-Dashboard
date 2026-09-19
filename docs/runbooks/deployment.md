# Развёртывание REAL2

Цель: воспроизводимый запуск `web` и `worker` за HTTPS-прокси, без единой
записи в amoCRM и без публикации в Google, пока это не включено вручную.

## Что нужно на хосте

- Ubuntu 24.04 LTS, Docker и Docker Compose v2;
- открытые порты 22, 80, 443, остальные закрыты файрволом;
- пользователь развёртывания без root, входящий в группу `docker`;
- домен, указывающий на хост (Caddy сам получит сертификат);
- управляемый PostgreSQL/Supabase без автопаузы и с включёнными бэкапами.

## Секреты

Файлы `/etc/real2/web.env` и `/etc/real2/worker.env` создаёт владелец, права
`0600`, владелец — пользователь развёртывания. В репозитории их нет и быть не
может. Минимальный состав — как в `.env.example`; дополнительно для воркера
нужны `WORKER_DATABASE_URL` и `RETENTION_DATABASE_URL` с отдельными ролями.

Оба внешних флага в файлах остаются `false`:

```
SYNC_ENABLED=false
SHEET_PUBLISH_ENABLED=false
```

Их включение — отдельное решение владельца, оформленное по
`docs/runbooks/sheet-publication-disable.md` в обратную сторону.

## Проверка перед запуском

```bash
node scripts/check-deployment-config.mjs deploy/docker-compose.production.yml
docker compose -f deploy/docker-compose.production.yml config --quiet
```

Проверка падает, если файл включает синхронизацию или публикацию, содержит
защищённый идентификатор таблицы, приватный ключ или пароль базы.

## Запуск

```bash
export REAL2_DOMAIN=dashboard.example.ru
export REAL2_WEB_IMAGE=ghcr.io/owner/real2-web@sha256:<digest>
export REAL2_WORKER_IMAGE=ghcr.io/owner/real2-worker@sha256:<digest>
docker compose -f deploy/docker-compose.production.yml up -d
```

Образы подключаются только по digest: тег `latest` не даёт воспроизводимости.

## Мониторинг

- внешний аптайм-монитор: `GET https://<домен>/api/health/live` — отвечает без
  обращения к базе и не требует прав;
- готовность: `GET /api/health/ready` — отдаёт только `{ "ready": true|false }`;
- свежесть и оповещения: `GET /api/system/status` под сессией admin или head.
  Учётные данные не вставляются в URL монитора.

## Обновление

1. собрать и подписать образы, зафиксировать digest;
2. применить миграции: `supabase db push` с рабочей строкой подключения;
3. `docker compose ... up -d` — Caddy и веб переживают перезапуск воркера;
4. проверить `/api/health/ready` и страницу «Состояние системы».

## Откат

Откат — это возврат к предыдущему digest образов. Миграции не откатываются
автоматически: снимки метрик и история публикаций неизменяемы, поэтому откат
кода безопасен, а откат схемы выполняется только по
`docs/runbooks/backup-restore.md`.
