# SPEC.md — техническая спецификация дашборда РЕАЛ ДВА

> Слой 2 по Spec-First Methodology.
>
> Версия: 0.1. Дата: 2026-09-12. Статус: ожидает утверждения заказчиком.
>
> Нормативные приложения: `METRICS_CATALOG.md` и `SECURITY_READ_ONLY.md`.

---

## 0. Глобальные контракты

### 0.1 Цель MVP

MVP автоматически читает одну воронку amoCRM, строит ежедневные показатели по дате создания лида, показывает их в закрытом веб-дашборде и после теневой приёмки публикует только в отдельную копию текущей Google-таблицы.

MVP не изменяет amoCRM ни при каких пользовательских действиях и не имеет прав записи в исходную Google-таблицу.

### 0.2 Стек

| Слой | Технология |
|---|---|
| Web/API | Next.js 16, React 19, TypeScript 5.9 |
| UI | Tailwind CSS 4, shadcn/ui, Recharts 3 |
| Validation | Zod 4 |
| Database | Supabase Pro, PostgreSQL 16, RLS, ежедневные резервные копии, без автопаузы |
| Auth | Supabase Auth с JWT claims, проверяемыми сервером и PostgreSQL RLS |
| Worker | Node.js 22 LTS, отдельный процесс с Postgres advisory lock |
| Deployment | Docker Compose: `web`, `worker`; внешняя управляемая БД |
| Tests | Vitest, PGlite, Playwright, mock HTTP servers |
| Monitoring | JSON logs, health endpoints, email alerts, внешний uptime check |

В production фиксируются точные версии lockfile. Замена стека требует отдельной архитектурной спецификации.

Первая миграция включает расширения `pgcrypto` и `citext`; все последующие миграции применяются в порядке зависимостей и имеют обратный `down`-сценарий для staging.

Обязательные production-переменные без значений в репозитории:

- `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- `AMO_BASE_URL`, `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`, `AMO_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`;
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_TARGET_SPREADSHEET_ID`;
- `SYNC_ENABLED`, `SHEET_PUBLISH_ENABLED`;
- `SMTP_URL`, `ALERT_EMAILS`.

`AMO_BASE_URL` в production обязан точно совпадать с `https://555151.amocrm.ru`. Секреты передаются через secret manager платформы и никогда не попадают в git, клиентский bundle, логи или дампы ошибок.

### 0.3 Роли

| Роль | Возможности |
|---|---|
| `admin` | подключение OAuth, конфигурация, планы, качество данных, ручной sync, все отчёты |
| `head` | все отчёты, drill-down, качество и история синхронизаций без доступа к секретам |
| `manager` | собственные метрики и относящиеся к ним сделки |
| `service_worker` | серверная синхронизация и построение снимков |
| `sheet_publisher` | публикация утверждённого снимка в разрешённую таблицу-копию |

Публичной регистрации нет. Пользователя создаёт `admin`. Неактивный пользователь получает 403 и не видит данные.

### 0.4 Ответ API

Успех:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "trace_id": "01J...",
    "snapshot_version": 42,
    "generated_at": "2026-09-12T12:00:00Z",
    "source_fresh_at": "2026-09-12T11:58:43Z",
    "stale": false
  }
}
```

Ошибка:

```json
{
  "ok": false,
  "error": {
    "code": "E_VALIDATION",
    "message": "Проверьте параметры запроса",
    "trace_id": "01J..."
  }
}
```

Текст внешнего сервиса, SQL detail и персональные данные в ответ не попадают.

### 0.5 Коды ошибок

| Код | HTTP | Значение |
|---|---:|---|
| `E_AUTH_REQUIRED` | 401 | отсутствует действительная сессия |
| `E_FORBIDDEN` | 403 | роль не разрешает действие |
| `E_VALIDATION` | 422 | входные данные не прошли Zod/доменную проверку |
| `E_NOT_FOUND` | 404 | объект не существует или недоступен роли |
| `E_CONFLICT` | 409 | версия/состояние изменились конкурентно |
| `E_CONFIG_INCOMPLETE` | 409 | обязательный маппинг не подтверждён |
| `E_AMO_AUTH` | 502 | OAuth refresh не удался |
| `E_AMO_RATE_LIMIT` | 503 | лимит amoCRM не снялся после retry |
| `E_AMO_UPSTREAM` | 502 | amoCRM вернула ошибку или некорректный ответ |
| `E_AMO_METHOD_DENIED` | 403 | метод запрещён read-only политикой |
| `E_AMO_PATH_DENIED` | 403 | путь отсутствует в allowlist |
| `E_SYNC_LOCKED` | 409 | другой sync run уже выполняется |
| `E_SYNC_PARTIAL` | 409 | получены не все страницы/сущности |
| `E_DATA_QUALITY_BLOCK` | 409 | качество данных не допускает публикацию |
| `E_SHEET_PROTECTED` | 403 | target совпал с исходной таблицей |
| `E_SHEET_LAYOUT_MISMATCH` | 409 | структура копии изменилась |
| `E_SHEET_UPSTREAM` | 502 | Google API не выполнила запрос |
| `E_DB` | 500 | ошибка БД без раскрытия SQL detail |
| `E_INTERNAL` | 500 | необработанная внутренняя ошибка |

### 0.6 Даты, деньги и локаль

- события хранятся как `timestamptz` в UTC;
- отчётный день вычисляется в `Europe/Moscow` и хранится как `date`;
- сумма хранится как `numeric(14,2)` без float;
- UI использует локаль `ru-RU`;
- CSV/Excel экспорт использует ISO-даты в данных и русские подписи в заголовках;
- нормативные формулы находятся только в `METRICS_CATALOG.md`.

### 0.7 Идемпотентность и публикация

- внешние amo object IDs и event IDs имеют уникальные ограничения;
- каждый sync run имеет ULID `trace_id`;
- повторный запуск с теми же входами даёт тот же checksum снимка;
- кандидатный снимок создаётся отдельно от текущего;
- только полностью успешный и прошедший quality gates снимок получает статус `approved`;
- dashboard читает один атомарно выбранный `current_snapshot_id`;
- Google Sheets publisher читает только `approved` snapshot;
- частичный run не меняет dashboard и таблицу.

### 0.8 RLS-инварианты

- RLS включена на каждой таблице приложения;
- `anon` не имеет политик чтения или записи;
- роль не берётся из query/body;
- `manager` фильтруется по привязанному `amo_user_id`;
- raw payload доступен только `admin` и `service_worker`;
- OAuth ciphertext недоступен пользовательским ролям;
- `sheet_publisher` не читает raw payload и OAuth secrets;
- негативные RLS-сценарии проверяются отдельными тестами с существующими данными.

### 0.9 Четыре состояния интерфейса

Каждый экран реализует:

- `loading` — skeleton реальной формы экрана;
- `error` — человеческое сообщение, кнопка повторить и копируемый trace ID;
- `empty` — объяснение отсутствия данных и допустимое следующее действие;
- `success` — данные, время свежести и активные фильтры.

Если после успешной загрузки случился временный сбой, UI сохраняет последние данные и показывает stale banner, а не заменяет содержимое ошибкой или нулями.

### 0.10 Производительность и SLO

- загрузка overview p95: не более 2 секунд при готовом снимке;
- фильтрация готового snapshot p95: не более 700 мс;
- drill-down p95: не более 1,5 секунды на страницу 100 строк;
- свежесть данных: не более 10 минут для 95% времени месяца;
- успешность scheduled sync: не ниже 99% за календарный месяц;
- RPO БД: 24 часа; RTO: 4 часа;
- dashboard сохраняет последний корректный снимок при любом upstream-сбое.

---

## M1 — Доступ и роли

### M1.1 User Stories

1. Как сотрудник из allowlist, я хочу войти по email и паролю, чтобы увидеть разрешённый мне отчёт.
2. Как руководитель, я хочу видеть весь отдел, чтобы сравнивать менеджеров и каналы.
3. Как менеджер, я хочу видеть только свои данные, чтобы персональные показатели других сотрудников не раскрывались.
4. Как администратор, я хочу деактивировать доступ без удаления истории пользователя.
5. Как неавторизованный пользователь, я не хочу получать даже факт существования конкретной сделки через API.

### M1.2 Модель данных

```sql
create type app_role as enum ('admin', 'head', 'manager');

create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  email citext not null unique,
  full_name text not null check (length(full_name) between 2 and 120),
  role app_role not null,
  amo_user_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'manager' and amo_user_id is not null) or role <> 'manager')
);

create index app_users_amo_user_idx on app_users (amo_user_id)
where amo_user_id is not null;
```

RLS:

- пользователь читает собственную строку;
- `admin` читает и изменяет пользователей;
- `head` не изменяет пользователей;
- `manager` не может подменить `amo_user_id`;
- удаление запрещено всем ролям приложения, применяется только деактивация.

### M1.3 API

| Метод и путь | Роль | Вход | Результат |
|---|---|---|---|
| `POST /api/auth/login` | public | `{email,password}` | 200 с secure session cookie; 401 единым текстом |
| `POST /api/auth/logout` | authenticated | пусто | 204, сессия отозвана |
| `GET /api/me` | authenticated | нет | id, email, fullName, role, amoUserId |
| `GET /api/admin/users` | admin | pagination | список без auth internals |
| `POST /api/admin/users` | admin | email, fullName, role, amoUserId | 201 |
| `PATCH /api/admin/users/{id}` | admin | fullName, role, amoUserId, isActive | 200 с optimistic version check |

Пароль не проходит через application logs. Login rate limit: 5 неудачных попыток на email+IP за 15 минут, затем 15 минут блокировки.

### M1.4 Экраны

- `/login`: email, пароль, показать/скрыть пароль, состояние отправки, единая ошибка credentials.
- `/settings/users`: только admin; таблица, создание, смена роли, привязка amo user, деактивация.
- header: имя, роль, выход.

Loading, error, empty и success реализуются по глобальному контракту. Экран пользователей на mobile становится списком карточек.

### M1.5 Бизнес-логика

- Самостоятельной регистрации и восстановления доступа через публичную форму нет на MVP.
- Первый admin создаётся одноразовой server-side командой с email из `BOOTSTRAP_ADMIN_EMAIL`.
- Email нормализуется lowercase.
- Manager обязан быть связан ровно с одним активным amo user.
- Смена роли немедленно инвалидирует активные сессии пользователя.
- Deactivated user сохраняется в исторических отчётах по имени и amo user ID.

### M1.6 Крайние случаи

- Пользователь есть в Auth, но нет в `app_users`: 403 `E_FORBIDDEN`.
- Manager не привязан к amo user: создание/изменение отклоняется 422.
- amo user деактивирован: вход разрешён, но UI показывает предупреждение, история остаётся доступной.
- Два admin одновременно меняют пользователя: второй получает 409 по `updated_at` version.
- Последний активный admin не может деактивировать себя или понизить собственную роль.

---

## M2 — Внешняя OAuth-интеграция amoCRM

### M2.1 User Stories

1. Как admin, я хочу подключить аккаунт через внешний OAuth, чтобы сервис законно читал данные API.
2. Как admin, я хочу убедиться, что подключён именно `555151.amocrm.ru`, чтобы исключить чтение чужого аккаунта.
3. Как система, я хочу обновлять токен до истечения, чтобы синхронизации не прерывались.
4. Как владелец аккаунта, я хочу отключить интеграцию внутри дашборда без изменения сделок amoCRM.
5. Как специалист безопасности, я хочу доказать, что OAuth-секреты не доступны браузеру и не пишутся в логи.

### M2.2 Модель данных

```sql
create type connection_status as enum ('pending', 'active', 'reauth_required', 'disabled');

create table oauth_states (
  state_hash text primary key,
  created_by uuid not null references app_users(id),
  redirect_after text not null default '/settings/integrations',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table amo_connections (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null unique,
  subdomain text not null unique check (subdomain ~ '^[a-z0-9-]+$'),
  base_url text not null,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expires_at timestamptz not null,
  status connection_status not null,
  installed_by uuid not null references app_users(id),
  installed_at timestamptz not null default now(),
  refreshed_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);
```

`oauth_states` удаляются через 24 часа после истечения. Token ciphertext хранится до отключения, после чего заменяется криптографически случайными байтами и строка переводится в `disabled` для аудита.

RLS: пользовательские роли не читают token columns; status projection доступна admin; server functions работают как отдельная DB-role.

### M2.3 API

| Метод и путь | Роль | Поведение |
|---|---|---|
| `GET /api/integrations/amo/status` | admin | возвращает account ID, subdomain, status, expiresAt без токенов |
| `POST /api/integrations/amo/start` | admin | создаёт одноразовый state и возвращает authorization URL |
| `GET /api/integrations/amo/callback` | admin browser | проверяет state, меняет code на токены, читает `/api/v4/account`, сохраняет connection |
| `POST /api/integrations/amo/refresh` | admin | принудительный server-side refresh с lock |
| `POST /api/integrations/amo/disconnect` | admin | отключает локальное использование токенов; вызов business API amoCRM не выполняется |

OAuth exchange использует только `POST /oauth2/access_token`. Все остальные amoCRM вызовы проходят через GET-only transport из `SECURITY_READ_ONLY.md`.

### M2.4 Экраны

- `/settings/integrations`: карточка amoCRM с состоянием, поддоменом, account ID, сроком токена и последней проверкой.
- Кнопки: «Подключить», «Переподключить», «Проверить чтение», «Отключить».
- Перед отключением показывается точное следствие: новые sync остановятся, последний снимок сохранится.
- Ни один экран не показывает access token, refresh token или client secret.

### M2.5 Бизнес-логика

- Разрешённый account host — `555151.amocrm.ru`; другой host отклоняется 409.
- После callback обязательный GET `/api/v4/account` подтверждает account ID и subdomain.
- Refresh начинается за 10 минут до `token_expires_at` и защищён advisory lock по connection ID.
- При 401 прикладной запрос делает один refresh и один повтор; бесконечного цикла нет.
- Если refresh не удался, connection получает `reauth_required`, sync не стартует, последний снимок остаётся текущим.
- OAuth callback не включает настройку webhook и не вызывает endpoints изменения CRM.

### M2.6 Крайние случаи

- State отсутствует, истёк или использован: 422 без обмена code.
- Callback вернул другой аккаунт: токены не сохраняются, alert уровня critical.
- Одновременно пришли два refresh: второй ждёт lock и использует уже обновлённый токен.
- Новый refresh token сохранён, но процесс упал до commit: транзакция откатывается, предыдущая пара остаётся целой.
- Admin отключил интеграцию во время sync: run завершается `failed`, новый snapshot не создаётся.
- amoCRM недоступна: exponential backoff, затем `E_AMO_UPSTREAM` без удаления connection.

---

## M3 — Конфигурация воронки, этапов и каналов

### M3.1 User Stories

1. Как admin, я хочу увидеть доступные воронки и этапы из API, чтобы выбрать РЕАЛ ДВА по фактическим ID.
2. Как admin, я хочу подтвердить этап заявки и won status, чтобы расчёт не зависел от текста на скриншоте.
3. Как admin, я хочу сопоставить значения источника с нормализованными каналами, чтобы отчёт был единообразным.
4. Как руководитель, я хочу видеть неизвестные значения отдельно, чтобы данные не исчезали и не угадывались.
5. Как система, я хочу версионировать правила, чтобы любой исторический снимок можно было воспроизвести.

### M3.2 Модель данных

```sql
create table pipeline_configs (
  id uuid primary key default gen_random_uuid(),
  amo_connection_id uuid not null references amo_connections(id),
  pipeline_id bigint not null,
  pipeline_name text not null,
  application_status_id bigint not null,
  application_status_name text not null,
  won_status_id bigint not null,
  won_status_name text not null,
  source_field_id bigint,
  timezone text not null default 'Europe/Moscow' check (timezone = 'Europe/Moscow'),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  confirmed_by uuid not null references app_users(id),
  confirmed_at timestamptz not null default now(),
  unique (amo_connection_id, version)
);

create type channel_match_type as enum ('source_field_exact', 'tag_exact', 'integration_source_exact');

create table channel_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  priority smallint not null check (priority between 1 and 1000),
  match_type channel_match_type not null,
  match_value text not null,
  normalized_channel text not null check (normalized_channel in
    ('phone_uis','whatsapp','avito','instagram','site','telegram','max','unknown')),
  is_active boolean not null default true,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (config_id, match_type, match_value),
  unique (config_id, priority)
);

create table config_validations (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references pipeline_configs(id),
  checked_at timestamptz not null default now(),
  pipeline_found boolean not null,
  application_status_found boolean not null,
  won_status_found boolean not null,
  source_field_found boolean not null,
  metadata_checksum text not null,
  details jsonb not null default '{}'::jsonb
);
```

Только одна конфигурация connection может иметь `is_active=true`; это обеспечивается partial unique index. Старые версии не удаляются.

RLS: admin управляет; head читает активную проекцию и channel mappings; manager не видит settings.

### M3.3 API

| Метод и путь | Роль | Вход/результат |
|---|---|---|
| `GET /api/config/discovery` | admin | live GET метаданных amoCRM: pipelines, statuses, custom fields, users |
| `GET /api/config/current` | admin/head | активная конфигурация без секретов |
| `POST /api/config/validate` | admin | candidate IDs → результат проверки имён, связей и checksum |
| `POST /api/config/activate` | admin | валидированный candidate + channel rules → новая активная version |
| `GET /api/config/channel-values` | admin/head | встреченные raw значения и их количество |

`activate` использует optimistic checksum: если метаданные изменились после validate, возвращается 409 и конфигурация не активируется.

### M3.4 Экраны

- `/settings/pipeline`: выбор воронки, application status, won status и source field только из live discovery.
- `/settings/channels`: таблица встреченных значений, текущее правило, канал, количество сделок и состояние `mapped/unknown/conflict`.
- `/quality/config`: read-only для head, показывает последнюю проверку и расхождения метаданных.

### M3.5 Бизнес-логика

- Отображаемое имя используется для проверки, расчёт использует ID.
- Application и won status обязаны принадлежать выбранной воронке.
- Won status не может совпадать с application status.
- Приоритет каналов соответствует `METRICS_CATALOG.md`; свободный текст и substring match запрещены.
- Если два правила дают разные каналы одному лиду, результат `unknown` с issue `channel_rule_conflict`.
- Активация новой версии запускает полный пересчёт на неизменяемом raw слое; текущий snapshot не меняется до успеха.

### M3.6 Крайние случаи

- Переименовали этап без смены ID: validation создаёт warning, sync продолжается, admin подтверждает новое имя отдельной version.
- Этап исчез или перемещён в другую воронку: validation critical, публикация блокируется.
- Source field отсутствует: разрешены tag/integration rules; field-based rules становятся inactive в новой версии.
- Встретилось новое значение канала: лид относится к `unknown`, качество ухудшается, данные не теряются.
- Два admin активируют конфигурацию: выигрывает версия с актуальным metadata checksum, второй получает 409.
- Все channel rules удалены: активация отклоняется, потому что начальный набор из `METRICS_CATALOG.md` обязан присутствовать.

---

## M4 — Синхронизация и сырой журнал amoCRM

### M4.1 User Stories

1. Как руководитель, я хочу видеть изменения не позднее 10 минут, чтобы отчёт оставался рабочим инструментом в течение дня.
2. Как admin, я хочу запустить синхронизацию вручную, чтобы проверить исправленную конфигурацию без ожидания расписания.
3. Как аудитор, я хочу видеть, какие страницы и сущности были прочитаны, чтобы доказать полноту запуска.
4. Как система, я хочу безопасно повторять пересекающиеся интервалы API, чтобы не терять события на границе курсора.
5. Как владелец amoCRM, я хочу быть уверен, что синхронизация не отправляет команд изменения данных.

### M4.2 Модель данных

```sql
create type sync_kind as enum ('initial_backfill', 'incremental', 'nightly_reconciliation', 'manual');
create type sync_status as enum ('running', 'success', 'partial', 'failed');

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  connection_id uuid not null references amo_connections(id),
  config_id uuid not null references pipeline_configs(id),
  kind sync_kind not null,
  status sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_read integer not null default 0 check (pages_read >= 0),
  leads_read integer not null default 0 check (leads_read >= 0),
  events_read integer not null default 0 check (events_read >= 0),
  users_read integer not null default 0 check (users_read >= 0),
  retries integer not null default 0 check (retries >= 0),
  source_max_updated_at timestamptz,
  error_code text,
  error_summary text,
  checksum text,
  created_by uuid references app_users(id),
  check ((status = 'running' and finished_at is null) or
         (status <> 'running' and finished_at is not null))
);

create table sync_cursors (
  connection_id uuid not null references amo_connections(id),
  stream text not null check (stream in ('leads','events','users','metadata')),
  cursor_time timestamptz,
  cursor_external_id bigint,
  last_successful_run_id uuid references sync_runs(id),
  updated_at timestamptz not null default now(),
  primary key (connection_id, stream)
);

create type raw_entity_type as enum ('account', 'pipeline', 'status', 'user', 'lead');

create table raw_amo_objects (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  account_id bigint not null,
  entity_type raw_entity_type not null,
  external_id bigint not null,
  source_updated_at timestamptz,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (sync_run_id, entity_type, external_id)
);

create table raw_amo_events (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  account_id bigint not null,
  amo_event_id bigint not null,
  amo_lead_id bigint,
  event_type text not null,
  event_at timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (account_id, amo_event_id)
);

create table amo_api_audit (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references sync_runs(id),
  trace_id text not null,
  method text not null,
  normalized_path text not null,
  response_status integer,
  duration_ms integer not null check (duration_ms >= 0),
  attempt smallint not null check (attempt > 0),
  result text not null check (result in ('allowed','denied','success','error')),
  created_at timestamptz not null default now()
);
```

Индексы:

- `raw_amo_objects(entity_type, external_id, received_at desc)`;
- `raw_amo_events(amo_lead_id, event_at, amo_event_id)`;
- `sync_runs(status, started_at desc)`;
- `amo_api_audit(sync_run_id, created_at)`.

Raw payload хранится 90 дней, затем удаляется утверждённой retention job; hashes и нормализованная история сохраняются. Append-only обеспечивается отсутствием UPDATE/DELETE policies у application roles.

### M4.3 API и расписание

Внутренние worker-команды:

- `runSync('initial_backfill')` — все сделки целевой воронки и доступная история событий;
- `runSync('incremental')` — каждые 5 минут, события и сделки с overlap 10 минут;
- `runSync('nightly_reconciliation')` — ежедневно в 02:30 `Europe/Moscow`, полный проход сделок;
- `runSync('manual')` — по запросу admin, логика идентична scheduled run.

HTTP:

| Метод и путь | Роль | Результат |
|---|---|---|
| `POST /api/sync-runs` | admin | 202 с trace ID или 409 `E_SYNC_LOCKED` |
| `GET /api/sync-runs` | admin/head | пагинированная история |
| `GET /api/sync-runs/{id}` | admin/head | счётчики, страницы, safe error и audit summary |

### M4.4 Экраны

- `/sync`: свежесть, активный/последний run, тип, длительность, счётчики, retries.
- `/sync/{id}`: поток этапов run и агрегированный HTTP audit без query/body.
- Кнопка «Синхронизировать» доступна admin и требует подтверждения, если run уже был менее минуты назад.

### M4.5 Бизнес-логика

1. До advisory lock и любого сетевого вызова worker требует одновременно `SYNC_ENABLED=true` и DB-контроль `system_controls.sync_enabled=true`; иначе run не создаётся.
2. Worker получает advisory lock `(connection_id, 'sync')`.
3. Проверяет active connection и active config.
4. Читает metadata/users, затем events, затем leads; конкретный порядок фиксирован.
5. Для пагинации следует `_links.next` или документированному page/limit до отсутствия следующей страницы.
6. Каждая страница проходит schema validation до записи raw rows.
7. Cursors обновляются только в одной транзакции со статусом `success`.
8. На incremental используется overlap 10 минут; unique event ID удаляет повтор.
9. 401 вызывает один token refresh; 429/5xx — паузы 1, 3, 9, 27 и 60 секунд плюс jitter до 20%.
10. После пяти retry run получает `partial` или `failed` в зависимости от наличия записанных страниц.
11. Успешный run передаётся M5; неуспешный не строит production snapshot.

### M4.6 Крайние случаи

- Ответ 200 без обязательных полей: run `partial`, payload сохраняется в quarantine row, cursor не меняется.
- Страница повторилась или API зациклила next link: checksum страницы обнаруживает цикл, run `failed`.
- Сделка обновилась во время пагинации: overlap следующего run и nightly reconciliation восстанавливают изменение.
- События имеют одинаковое время: порядок определяется `(event_at, amo_event_id)`.
- API вернула меньше сделок более чем на 5% относительно последней полной сверки: critical alert, snapshot не публикуется.
- Worker завершился аварийно: watchdog через 20 минут переводит зависший `running` в `failed`; advisory lock освобождается соединением.
- Ручной и scheduled run совпали: первый получает lock, второй завершается 409 без сетевых обращений.

---

## M5 — Нормализация и история сделки

### M5.1 User Stories

1. Как руководитель, я хочу, чтобы один и тот же лид учитывался один раз независимо от числа синхронизаций.
2. Как аналитик, я хочу видеть первую дату достижения заявки и оплаты, чтобы объяснить каждый показатель.
3. Как admin, я хочу видеть неизвестные каналы и неполную историю отдельно, чтобы исправлять источник, а не терять сделку.
4. Как менеджер, я хочу перейти из drill-down в исходную карточку amoCRM.
5. Как система, я хочу пересчитать нормализацию по новой версии правил без изменения raw данных.

### M5.2 Модель данных

```sql
create table amo_users (
  account_id bigint not null,
  amo_user_id bigint not null,
  name text not null,
  email citext,
  is_active boolean not null,
  source_updated_at timestamptz,
  normalized_at timestamptz not null default now(),
  primary key (account_id, amo_user_id)
);

create table pipeline_statuses (
  account_id bigint not null,
  pipeline_id bigint not null,
  status_id bigint not null,
  name text not null,
  sort_order integer not null,
  is_closed boolean not null,
  is_won boolean not null,
  source_updated_at timestamptz,
  primary key (account_id, status_id)
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint not null,
  pipeline_id bigint not null,
  current_status_id bigint not null,
  current_responsible_user_id bigint,
  name text not null,
  price_rub numeric(14,2),
  created_at timestamptz not null,
  created_date date not null,
  source_updated_at timestamptz not null,
  normalized_channel text not null,
  channel_rule_id uuid references channel_rules(id),
  normalization_config_id uuid not null references pipeline_configs(id),
  amo_url text not null,
  is_deleted boolean not null default false,
  normalized_at timestamptz not null default now(),
  unique (account_id, amo_lead_id)
);

create table lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id bigint not null,
  amo_lead_id bigint not null,
  from_status_id bigint,
  to_status_id bigint not null,
  responsible_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create table lead_responsible_events (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_event_id bigint not null,
  amo_lead_id bigint not null,
  from_user_id bigint,
  to_user_id bigint,
  occurred_at timestamptz not null,
  unique (account_id, amo_event_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create table lead_milestones (
  account_id bigint not null,
  amo_lead_id bigint not null,
  application_at timestamptz,
  application_responsible_user_id bigint,
  won_at timestamptz,
  won_responsible_user_id bigint,
  currently_won boolean not null default false,
  recalculated_at timestamptz not null default now(),
  primary key (account_id, amo_lead_id),
  foreign key (account_id, amo_lead_id) references leads(account_id, amo_lead_id)
);

create type quality_severity as enum ('info', 'warning', 'blocking');
create type quality_status as enum ('open', 'resolved', 'accepted');

create table data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null,
  amo_lead_id bigint,
  sync_run_id uuid references sync_runs(id),
  code text not null,
  severity quality_severity not null,
  status quality_status not null default 'open',
  safe_details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index data_quality_one_open_issue_idx
  on data_quality_issues (account_id, coalesce(amo_lead_id, 0), code)
  where status = 'open';
```

Индексы: `leads(created_date)`, `leads(current_responsible_user_id, created_date)`, `leads(normalized_channel, created_date)`, `lead_stage_events(amo_lead_id, occurred_at, amo_event_id)`, `data_quality_issues(status, severity, code)`.

RLS: admin/head читают все нормализованные данные; manager читает leads, где `current_responsible_user_id = app_users.amo_user_id`; raw links и full payload не выдаются manager.

### M5.3 Серверная логика и API

Серверные функции:

```text
normalizeSyncRun(syncRunId, configId) -> NormalizationResult
rebuildLeadHistory(accountId, amoLeadId) -> LeadMilestones
resolveChannel(leadPayload, configVersion) -> ChannelResolution
scanDataQuality(syncRunId) -> QualitySummary
```

HTTP:

| Метод и путь | Роль | Результат |
|---|---|---|
| `GET /api/leads/{amoLeadId}` | admin/head или связанный manager | нормализованная карточка, milestones, stage history, amo URL |
| `GET /api/quality/issues` | admin/head | фильтры code/severity/status, cursor pagination |
| `POST /api/quality/issues/{id}/accept` | admin | принимает известное исключение с обязательной причиной |

`accept` не изменяет amoCRM и не редактирует raw данные. Blocking issue можно принять только для кода, явно разрешённого политикой; `missing_stage_history` и `E_SHEET_PROTECTED` принять нельзя.

### M5.4 Экраны

- `/quality`: KPI качества, группы по коду, список сделок и фильтры.
- `/leads/{amoLeadId}`: read-only facts, история этапов, ответственные, канал, сумма и ссылка «Открыть в amoCRM».
- Unknown channel rows содержат исходный безопасный вариант и кнопку перехода в настройки каналов для admin.

### M5.5 Бизнес-логика

- Нормализация одного sync run выполняется транзакционно.
- Последний lead snapshot выбирается по `(source_updated_at, received_at)`.
- Пустое имя сделки нормализуется в `Сделка #<amo_lead_id>` и не считается ошибкой качества.
- Имя, состоящее преимущественно из номера телефона, хранится в защищённом normalized record, но наружу получает безопасное `display_name = Сделка #<amo_lead_id>`.
- История этапов сортируется по `(occurred_at, amo_event_id)`.
- `application_at` — первое event-наблюдение целевого этапа.
- `won_at` — первое event-наблюдение won; `currently_won` определяется последним lead snapshot.
- Повторный вход в этап не создаёт второй milestone.
- Current manager и channel пересчитываются из последнего snapshot по активной config version.
- Нераспознанный канал сохраняется как `unknown` с issue, но лид входит в общий итог.
- Лид без полной stage history не получает выдуманный milestone.
- Amo URL строится только из подтверждённого subdomain и числового lead ID.

### M5.6 Крайние случаи

- `created_at` отсутствует или невалиден: blocking issue, лид не входит в агрегаты, raw сохраняется.
- `price` строкой или за пределами `numeric(14,2)`: blocking issue для won, warning для open.
- Current status не существует в metadata: blocking issue и остановка snapshot.
- Ответственный удалён из текущего users API: сохраняется последний известный пользователь как deactivated.
- Два stage events противоречат друг другу: порядок по event ID, issue `stage_history_conflict`, публикация блокируется для затронутой когорты.
- Лид из другой воронки попал в API page: raw сохраняется для аудита, но normalization помечает `out_of_scope_pipeline` и не включает его в отчёт.
- Lead исчез из nightly reconciliation: `is_deleted=true` только после двух последовательных полных проходов; первый пропуск создаёт warning.

---

## M6 — Движок метрик, планы и снимки

### M6.1 User Stories

1. Как руководитель, я хочу видеть лиды, заявки, оплаты и выручку по дням создания, чтобы таблица автоматически обновляла прошлую когорту после оплаты.
2. Как руководитель, я хочу сравнивать менеджеров и каналы по одинаковым формулам.
3. Как admin, я хочу задавать месячный план без изменения фактических данных.
4. Как аудитор, я хочу воспроизвести снимок по версии конфигурации и sync run.
5. Как система, я хочу отклонять снимок, если сумма разрезов не сходится с общим итогом.

### M6.2 Модель данных

```sql
create type plan_metric_key as enum ('leads_created', 'applications', 'payments', 'revenue');

create table sales_plans (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  manager_key text not null,
  metric_key plan_metric_key not null,
  target_value numeric(14,2) not null check (target_value > 0),
  version integer not null check (version > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (month, manager_key, metric_key, version),
  check (valid_to is null or valid_to > valid_from)
);

create type snapshot_status as enum ('candidate', 'approved', 'published', 'rejected');

create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  version bigint generated always as identity unique,
  sync_run_id uuid not null references sync_runs(id),
  config_id uuid not null references pipeline_configs(id),
  status snapshot_status not null default 'candidate',
  generated_at timestamptz not null default now(),
  source_fresh_at timestamptz not null,
  approved_at timestamptz,
  published_at timestamptz,
  checksum text not null,
  quality_summary jsonb not null,
  rejection_code text,
  unique (sync_run_id, config_id)
);

create table metric_cells (
  snapshot_id uuid not null references metric_snapshots(id),
  report_date date not null,
  manager_key text not null,
  channel_key text not null,
  leads_created integer not null check (leads_created >= 0),
  applications integer not null check (applications >= 0),
  payments integer not null check (payments >= 0),
  revenue numeric(14,2) not null,
  primary key (snapshot_id, report_date, manager_key, channel_key)
);

create table metric_lead_facts (
  snapshot_id uuid not null references metric_snapshots(id),
  account_id bigint not null,
  amo_lead_id bigint not null,
  display_name text not null,
  report_date date not null,
  manager_key text not null,
  manager_name text not null,
  channel_key text not null,
  current_status_id bigint not null,
  price_rub numeric(14,2),
  application_at timestamptz,
  won_at timestamptz,
  currently_won boolean not null,
  amo_url text not null,
  quality_codes text[] not null default '{}',
  primary key (snapshot_id, account_id, amo_lead_id)
);

create index metric_lead_facts_drilldown_idx
  on metric_lead_facts (snapshot_id, report_date, manager_key, channel_key, amo_lead_id);

create table stage_snapshot_rows (
  snapshot_id uuid not null references metric_snapshots(id),
  status_id bigint not null,
  status_name text not null,
  manager_key text not null,
  open_count integer not null check (open_count >= 0),
  open_amount numeric(14,2) not null,
  median_age_seconds bigint,
  average_age_seconds bigint,
  primary key (snapshot_id, status_id, manager_key)
);

create table current_snapshot (
  singleton boolean primary key default true check (singleton),
  snapshot_id uuid not null references metric_snapshots(id),
  updated_at timestamptz not null default now()
);
```

Для `metric_cells` используются ключи:

- manager: `all`, `unassigned`, `amo:<user_id>`;
- channel: `all` или нормализованный канал из каталога.

Комбинации materialize только для `all/all`, `manager/all`, `all/channel` и фактически встреченных `manager/channel`, чтобы не создавать пустой декартов продукт.

### M6.3 Серверная логика и API

```text
buildMetricSnapshot(syncRunId, configId) -> CandidateSnapshot
validateSnapshot(snapshotId) -> SnapshotValidation
approveSnapshot(snapshotId) -> ApprovedSnapshot
rejectSnapshot(snapshotId, errorCode) -> RejectedSnapshot
```

API планов:

| Метод и путь | Роль | Вход/результат |
|---|---|---|
| `GET /api/plans?month=YYYY-MM-01` | admin/head/manager | планы в пределах роли |
| `POST /api/plans` | admin | month, managerKey, metricKey, targetValue → новая version |
| `GET /api/snapshots/{version}` | admin/head | metadata и quality summary |

План не редактируется на месте: новое значение закрывает `valid_to` прежней версии и создаёт новую строку.

### M6.4 Экраны

- `/settings/plans`: month picker, общий план и планы менеджеров, история версий.
- Карточки plan/fact на overview и manager detail.
- `/snapshots/{version}`: checksum, источник, config version, quality gates и расхождения разрезов.

### M6.5 Бизнес-логика

- Все формулы берутся из `METRICS_CATALOG.md`.
- Snapshot строится в транзакции `REPEATABLE READ` из одного согласованного состояния нормализованных таблиц.
- `metric_lead_facts` фиксирует членство и отображаемые значения каждой сделки в конкретной версии; drill-down никогда не смешивает snapshot с более новым mutable lead state.
- `report_date = created_date` для всех milestones и revenue.
- Current responsible и channel являются измерениями снимка; история событий остаётся в drill-down.
- Total `all/all` обязан равняться сумме manager rows и отдельно сумме channel rows для каждой даты.
- `payments <= applications <= leads_created` для каждой общей когорты. Нарушение создаёт blocking issue; система не дополняет пропущенную заявку догадкой.
- Revenue равна сумме price всех currently won leads в cohort до копейки.
- Candidate получает `approved` только если sync success, config valid, blocking issues = 0 и все cross-foot checks сошлись.
- `current_snapshot` меняется одной транзакцией после approval.

### M6.6 Крайние случаи

- В периоде нет лидов: создаются нулевые totals, проценты null; snapshot остаётся валидным.
- Менеджер сменился после оплаты: новый snapshot относит сделку текущему ответственному, drill-down показывает историю смен.
- Channel rule изменился: создаётся новый snapshot/config checksum; старый воспроизводим по прежней версии.
- Won сделка без валидной суммы: snapshot candidate отклоняется `E_DATA_QUALITY_BLOCK`.
- Application существует, но current won снят: application остаётся, payments/revenue уменьшаются.
- Изменён план: factual snapshot не пересобирается; plan/fact API соединяет актуальную плановую version на чтении.
- Две сборки snapshot для одного run/config: unique constraint возвращает существующий результат.

---

## M7 — Dashboard API и drill-down

### M7.1 User Stories

1. Как руководитель, я хочу получить все блоки обзора одним согласованным ответом, чтобы карточки не показывали цифры разных версий.
2. Как пользователь, я хочу поделиться ссылкой с активными фильтрами, чтобы коллега увидел тот же срез в пределах своих прав.
3. Как руководитель, я хочу нажать на число и получить конкретные сделки, чтобы проверить расчёт.
4. Как manager, я хочу, чтобы подмена manager query не раскрыла чужие сделки.
5. Как пользователь, я хочу видеть время источника и версию снимка, чтобы понимать свежесть данных.

### M7.2 Модель данных

Отдельных mutable-таблиц модуль не создаёт. Он читает `current_snapshot`, `metric_cells`, `metric_lead_facts`, `stage_snapshot_rows`, `sales_plans` и quality summary.

Для ускорения создаются индексы:

```sql
create index metric_cells_lookup_idx
  on metric_cells (snapshot_id, report_date, manager_key, channel_key);

create index leads_current_portfolio_idx
  on leads (created_date, current_responsible_user_id, normalized_channel, amo_lead_id);
```

### M7.3 API

Общие query-параметры:

- `from`, `to`: ISO date; максимум 366 дней;
- `manager`: `all`, `unassigned` или `amo:<id>`;
- `channel`: `all` или нормализованный канал;
- `compare`: `previous` или `none`.

| Метод и путь | Роль | Ответ |
|---|---|---|
| `GET /api/dashboard/overview` | authenticated | KPI, plan/fact, daily trend, quality summary, meta |
| `GET /api/dashboard/managers` | admin/head; manager=self | таблица менеджеров и totals |
| `GET /api/dashboard/channels` | authenticated | каналы, конверсии, totals |
| `GET /api/dashboard/funnel` | authenticated | stages, counts, amounts, age statistics |
| `GET /api/dashboard/attention` | authenticated | агрегаты и разрешённый роли список проблемных сделок |
| `GET /api/dashboard/drilldown` | authenticated | cursor page до 100 сделок |
| `GET /api/dashboard/export.csv` | admin/head; manager=self | CSV текущего среза |

`drilldown` дополнительно принимает `metric`, `reportDate` или range, manager/channel и opaque cursor. Разрешённые metric values: `leads_created`, `applications`, `payments`, `revenue`, `stage_open`, `quality_issue`.

Пример строки drill-down:

```json
{
  "amoLeadId": 12345678,
  "name": "Сделка #12345678",
  "createdDate": "2026-09-05",
  "applicationAt": "2026-09-07T09:12:00Z",
  "wonAt": "2026-09-10T14:30:00Z",
  "manager": {"id": 42, "name": "Патя"},
  "channel": "phone_uis",
  "price": "12500.00",
  "amoUrl": "https://555151.amocrm.ru/leads/detail/12345678",
  "quality": []
}
```

### M7.4 Экраны и компоненты

Модуль поставляет данные для M8. API не возвращает HTML. OpenAPI JSON генерируется из Zod schemas и проверяется contract tests.

### M7.5 Бизнес-логика

- Все блоки одного ответа используют один `snapshot_id`.
- Manager role принудительно получает собственный `manager_key`; query игнорировать нельзя — чужой key возвращает 403.
- Сравнение периода вычисляется из того же snapshot.
- API не выполняет live-запросы к amoCRM во время пользовательского запроса.
- Телефоны и raw custom fields не входят в dashboard API.
- CSV содержит UTF-8 BOM, разделитель `;`, ISO date и локализованные заголовки.
- Cache key включает user role/amo user, snapshot version и normalized filters.

### M7.6 Крайние случаи

- `from > to` или диапазон >366 дней: 422.
- Snapshot отсутствует: 503 `E_CONFIG_INCOMPLETE` с экраном initial setup, не нулевой отчёт.
- Последний sync просрочен: 200 с `meta.stale=true` и последними данными.
- Cursor относится к другой snapshot version: 409, UI начинает drill-down заново.
- Сделка изменилась после snapshot: drill-down показывает состояние snapshot и отметку версии, а не смешивает live current data.
- Manager деактивирован: head видит историческую строку; manager-сессия запрещена M1.

---

## M8 — Интерфейс дашборда

### M8.1 User Stories

1. Как руководитель, я хочу за один экран понять план/факт, заявки, оплаты, выручку и главные отклонения.
2. Как руководитель, я хочу сравнить менеджеров и каналы по одинаковым показателям.
3. Как пользователь, я хочу раскрыть любую цифру до списка сделок и открыть карточку amoCRM.
4. Как admin, я хочу видеть проблемы синхронизации и качества раньше, чем они попадут в Google Sheets.
5. Как пользователь телефона, я хочу читать ключевые показатели без горизонтальной прокрутки всего экрана.

### M8.2 Модель данных

UI не хранит бизнес-данные. Локальное состояние ограничено фильтрами, состоянием раскрытия и пользовательской темой. Нормативным контрактом являются типы ответов M7.

Фильтры сериализуются в URL:

```text
/?from=2026-09-01&to=2026-09-30&manager=all&channel=all&compare=previous
```

### M8.3 Серверная логика

- Server Components загружают первоначальный snapshot.
- Client Components отвечают только за фильтры, charts и dialogs.
- URL search params валидируются одной schema до запроса данных.
- Кнопка обновления вызывает M4 manual sync только у admin; она не вызывает amoCRM из браузера.
- UI polling проверяет только `/api/sync-runs/{id}` и после success обновляет страницу snapshot.

### M8.4 Экраны и компоненты

#### `/` — Обзор

- header: бренд РЕАЛ ДВА, период, manager, channel, последняя синхронизация;
- stale/quality banner;
- KPI: лиды, заявки, оплаты, выручка, lead→application, application→payment, средний чек, выполнение revenue plan;
- график «Лиды → заявки → оплаты» по report date;
- план/факт за месяц;
- компактный блок «Требует внимания» с переходом в `/attention`.

#### `/managers` — Менеджеры

- таблица: лиды, заявки, оплаты, выручка, две конверсии, средний чек, выполнение плана;
- сортировка по любому числовому столбцу;
- строка итогов;
- manager detail с дневным графиком и drill-down;
- manager role сразу попадает на собственный detail.

#### `/channels` — Каналы

- таблица тех же funnel metrics;
- donut только по доле оплат/выручки, переключаемый без изменения формулы;
- тренд каналов по дням;
- группа `Без значения` всегда видна, даже если нулевая в текущем фильтре, когда есть открытые quality issues.

#### `/funnel` — Воронка

- этапы в порядке amoCRM;
- count, amount, медианный возраст, доля от входа;
- выбранный этап открывает drill-down;
- отдельный список «застряли дольше порога».

#### `/attention` — Требует внимания

- без источника;
- без ответственного;
- won без корректной суммы;
- неполная история этапов;
- открытая сделка без задачи или с просроченной задачей, если task read endpoint добавлен в отдельной утверждённой фиче;
- застрявшие на этапе дольше configurable threshold.

MVP не создаёт и не закрывает задачи; список ведёт только в amoCRM.

#### `/sync` и `/settings/*`

Реализуют экраны M2–M6 и M10. Manager не видит эти маршруты.

#### Общие компоненты

- `DashboardHeader`, `FilterBar`, `FreshnessBadge`, `QualityBanner`;
- `KpiCard`, `PlanFactCard`, `FunnelTrendChart`, `StageFunnel`;
- `ManagersTable`, `ChannelsTable`, `AttentionTable`;
- `DrilldownDrawer`, `SyncRunTimeline`, `TraceIdCopy`;
- `PageSkeleton`, `PageError`, `PageEmpty`.

### M8.5 Бизнес-логика и UX

- Фильтры имеют состояния pending и applied; данные меняются после «Применить».
- Все числа форматируются централизованно; сырые округления в компонентах запрещены.
- Графики не являются единственным способом прочитать значение: таблица или tooltip обязательны.
- Цвет не является единственным признаком статуса; используются иконка и текст.
- На mobile KPI идут 2×N, таблицы превращаются в карточки или получают локальную горизонтальную прокрутку.
- Глобальные fade/slide page transitions для тяжёлых экранов запрещены.
- Телефон не показывается; переход в amoCRM открывается новой вкладкой с `noopener,noreferrer`.
- Каждая страница показывает snapshot version и source freshness в footer.

### M8.6 Крайние случаи

- Один канал/менеджер: chart не ломается, таблица остаётся основной формой.
- Очень длинное имя этапа: переносится внутри ячейки, не обрезает count/amount.
- Нет предыдущего периода: delta показывает «—», не 0%.
- Данные stale: пользователь продолжает работу, но stale banner закреплён сверху.
- Manual sync упал: данные не исчезают; toast содержит safe message и trace ID.
- Два быстрых изменения фильтров: отменяется устаревший запрос, ответ старой версии не перезаписывает новый.
- Экран 375 px и диапазоны 768/1024/1280/1440 проверяются визуально в Playwright.

---

## M9 — Публикация в копию Google Sheets

### M9.1 User Stories

1. Как руководитель, я хочу сохранить привычную Google-таблицу, но получать в ней автоматические цифры.
2. Как владелец исходной таблицы, я хочу техническую гарантию, что оригинал не станет целью записи.
3. Как admin, я хочу сначала проверить раскладку копии, чтобы изменение заголовка не сдвинуло цифры в чужие ячейки.
4. Как аудитор, я хочу видеть каждую попытку публикации, snapshot version и checksum.
5. Как система, я хочу оставить предыдущие значения при ошибке Google API или quality gate.

### M9.2 Модель данных

```sql
create type sheet_target_status as enum ('draft', 'validated', 'active', 'disabled');
create type sheet_report_kind as enum ('channels_daily', 'plan_fact');
create type sheet_value_type as enum ('integer', 'money', 'percent', 'date', 'text');

create table sheet_targets (
  id uuid primary key default gen_random_uuid(),
  spreadsheet_id text not null unique,
  expected_title text not null,
  status sheet_target_status not null default 'draft',
  layout_fingerprint text,
  validated_at timestamptz,
  activated_by uuid references app_users(id),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create table sheet_layout_mappings (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references sheet_targets(id),
  report_kind sheet_report_kind not null,
  logical_field text not null,
  sheet_name text not null,
  range_a1 text not null,
  value_type sheet_value_type not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (target_id, report_kind, logical_field),
  unique (target_id, sheet_name, range_a1)
);

create type publication_status as enum ('running', 'success', 'failed', 'blocked');

create table sheet_publications (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  target_id uuid not null references sheet_targets(id),
  snapshot_id uuid not null references metric_snapshots(id),
  attempt integer not null check (attempt > 0),
  status publication_status not null default 'running',
  layout_fingerprint text not null,
  payload_checksum text not null,
  cells_planned integer not null check (cells_planned >= 0),
  cells_written integer not null default 0 check (cells_written >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_summary text,
  unique (target_id, snapshot_id, attempt)
);

create unique index sheet_publications_one_success_idx
  on sheet_publications (target_id, snapshot_id)
  where status = 'success';
```

Protected spreadsheet ID не хранится как обычный target: он существует в неизменяемом application denylist из `SECURITY_READ_ONLY.md`.

### M9.3 API и серверная логика

| Метод и путь | Роль | Результат |
|---|---|---|
| `POST /api/sheets/targets` | admin | регистрирует ID копии после denylist check |
| `POST /api/sheets/targets/{id}/validate` | admin | читает metadata/headers, возвращает fingerprint и missing mappings |
| `POST /api/sheets/targets/{id}/activate` | admin | активирует только validated target |
| `GET /api/sheets/mappings` | admin/head | layout mapping без credentials |
| `PUT /api/sheets/mappings` | admin | целиком заменяет candidate mapping и повторно валидирует |
| `POST /api/sheet-publications` | admin | публикует approved snapshot при включённом feature flag |
| `GET /api/sheet-publications` | admin/head | история публикаций |

Worker-функция:

```text
publishSnapshot(snapshotId, targetId) -> PublicationResult
```

### M9.4 Экраны

- `/settings/google-sheet`: ID/название копии, status, fingerprint, доступ service account.
- Mapping editor: logical field, лист, диапазон, тип, preview текущего и нового значения.
- Publication preview: число ячеек, totals, snapshot version, без записи.
- `/sheet-publications`: время, status, snapshot, cells, checksum, trace ID.

Начальная проверка копии ожидает листы, соответствующие текущему ручному отчёту: `каналы сентябрь 2026` и `выполнение плана сентябрь 2026`. Последующие месяцы выбираются по явно сохранённому mapping, а не угадываются по позиции вкладки.

Исходная таблица отображается только как защищённый reference ID с красным статусом «запись запрещена».

### M9.5 Бизнес-логика

1. До создания Google client publisher требует одновременно `SHEET_PUBLISH_ENABLED=true` и DB-контроль `system_controls.sheet_publish_enabled=true`; иначе завершается без сетевого вызова.
2. Пользователь вручную создаёт копию исходной таблицы в Google Drive.
3. Копия расшаривается service account; оригинал не расшаривается.
4. Admin регистрирует ID копии; denylist проверяется до Google API.
5. Validator читает title, sheet IDs, names, dimensions, headers и формирует layout fingerprint.
6. Все обязательные logical fields должны иметь непересекающиеся ranges правильного размера.
7. Publisher повторно читает fingerprint непосредственно перед записью.
8. Values строятся только из одного approved snapshot.
9. Все UpdateCells/RepeatCell requests отправляются одним `spreadsheets.batchUpdate`.
10. После ответа publisher читает записанные ranges и сравнивает payload checksum.
11. Только после verify publication получает `success`, snapshot — `published`.
12. Повтор после failed/blocked создаёт следующий `attempt`; уже успешный snapshot повторно не записывается.

Автоматическое расписание публикации запускается после каждого нового approved snapshot, но только при обоих включённых предохранителях и активном target.

### M9.6 Крайние случаи

- Target ID равен оригиналу: 403 `E_SHEET_PROTECTED`, Google API не вызывается.
- Service account случайно получил доступ к оригиналу: runtime denylist всё равно блокирует запись; security check создаёт critical alert.
- Sheet переименован, добавлен столбец или смещён заголовок: fingerprint mismatch, публикация `blocked`.
- Одна из mappings пересекается с другой: validation 422.
- Google вернула 429/5xx: retry 1, 3, 9, 27, 60 секунд; предыдущие значения сохраняются.
- Post-write checksum не совпал: publication `failed`, alert critical; automatic publish выключается до ручной validation.
- Один snapshot публикуется повторно: unique constraint возвращает прежний success без новой записи.
- Человек меняет ячейки после публикации: следующая публикация меняет только явно mapped ranges; остальная таблица не затрагивается.

---

## M10 — Наблюдаемость, алерты и эксплуатация

### M10.1 User Stories

1. Как admin, я хочу за минуту понять, синхронизируется ли система и насколько свежи цифры.
2. Как руководитель, я хочу видеть предупреждение о stale data прямо в дашборде.
3. Как разработчик поддержки, я хочу получить trace ID и безопасную последовательность событий без персональных данных.
4. Как владелец, я хочу восстановить систему из резервной копии в пределах RTO.
5. Как система, я хочу автоматически остановить публикацию при критическом расхождении.

### M10.2 Модель данных

```sql
create type alert_severity as enum ('info', 'warning', 'critical');
create type alert_status as enum ('open', 'acknowledged', 'resolved');

create table system_alerts (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  source text not null,
  code text not null,
  severity alert_severity not null,
  status alert_status not null default 'open',
  safe_summary text not null,
  safe_context jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references app_users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create unique index system_alerts_one_open_idx
  on system_alerts (source, code)
  where status = 'open';

create table system_controls (
  key text primary key check (key in ('sync_enabled', 'sheet_publish_enabled')),
  enabled boolean not null,
  reason text not null,
  updated_by uuid references app_users(id),
  updated_at timestamptz not null default now()
);

insert into system_controls (key, enabled, reason) values
  ('sync_enabled', false, 'initial safe state'),
  ('sheet_publish_enabled', false, 'initial safe state');
```

Операционные логи выводятся в JSON и хранятся 30 дней. Alert records хранятся один год. Внешний log sink не получает raw payload.

### M10.3 API и фоновые проверки

| Метод и путь | Доступ | Ответ |
|---|---|---|
| `GET /api/health/live` | monitoring | 200, если процесс отвечает |
| `GET /api/health/ready` | monitoring | 200 только при DB, active config и current snapshot; без деталей секретов |
| `GET /api/system/status` | admin/head | freshness, last sync/publication, open alerts, snapshot version |
| `GET /api/alerts` | admin/head | filtered cursor list |
| `POST /api/alerts/{id}/acknowledge` | admin | фиксирует ознакомление |

Фоновые проверки:

- каждые 5 минут — возраст последнего sync;
- после каждого run — counts/checksum/retry/quality;
- после publication — read-back checksum;
- ежедневно — наличие backup;
- ежемесячно — автоматизированный restore drill в изолированную БД.

### M10.4 Экраны

- `/system`: три статуса «amoCRM», «База и расчёт», «Google-копия»; время и последняя успешная операция.
- `/alerts`: severity, code, безопасное описание, occurrence count, trace ID, acknowledge.
- Глобальный banner: warning после 10 минут stale, critical после 30 минут или blocking quality.

### M10.5 Бизнес-логика

- Каждый HTTP request и background job получает ULID trace ID.
- Structured log fields: timestamp, level, service, operation, trace_id, duration_ms, result, error_code.
- Critical alert отправляется через SMTP-конфигурацию `SMTP_URL` на обязательные адреса `ALERT_EMAILS` и повторяется не чаще раза в 30 минут для того же open alert.
- Warning группируется и отправляется не чаще раза в 2 часа.
- Успешный run автоматически закрывает только alerts, причина которых действительно устранена.
- DB-контроль `sheet_publish_enabled` автоматически выключается при sheet protection/layout/checksum critical; переменная окружения `SHEET_PUBLISH_ENABLED` остаётся главным аварийным выключателем. Повторное включение DB-контроля требует admin validation.
- Backup: daily, retention 14 daily + 3 monthly; encryption at rest; restore drill фиксирует duration и checksum.

### M10.6 Крайние случаи

- Email alert provider недоступен: alert остаётся open, delivery retry выполняется отдельно и не влияет на snapshot.
- Health endpoint атакуют часто: rate limit и минимальный ответ без версии/инфраструктуры.
- Один сбой повторяется тысячу раз: одна open запись с `occurrence_count`, не тысяча строк.
- Логи содержат совпадение с token/phone scanner: запись редактируется маскером до отправки, security alert создаётся локально.
- База доступна read-only после инцидента: dashboard отдаёт текущий snapshot, sync/publish disabled.
- Restore drill не сошёлся checksum: critical alert и запрет считать backup проверенным.

---

## 11. Сквозные сценарии

### S1. Новый лид без заявки

1. amoCRM создаёт лид 5 сентября.
2. Incremental sync читает событие и lead snapshot.
3. Raw event/object сохраняются, lead нормализуется.
4. Snapshot увеличивает `leads_created` 5 сентября на 1.
5. Application/payment/revenue не изменяются.
6. Drill-down показывает сделку и ссылку в amoCRM.

### S2. Заявка через два дня

1. Лид S1 переходит в «Завершение (самовывоз или доставка)» 7 сентября.
2. Event получает `application_at`.
3. Новый snapshot увеличивает `applications` в строке 5 сентября.
4. Строка 7 сентября не получает дополнительного лида или заявки.

### S3. Оплата в следующем месяце

1. Лид создан 30 сентября, заявка 30 сентября, won 2 октября с ценой 25 000 ₽.
2. Октябрьский sync подтверждает won.
3. Snapshot увеличивает `payments` и `revenue` в когорте 30 сентября на 1 и 25 000 ₽.
4. Фактический `won_at=2 октября` остаётся в drill-down.

### S4. Повторный sync

1. Worker повторно читает пересекающиеся события и тот же lead snapshot.
2. Unique constraints не создают новые события/лиды.
3. Snapshot checksum совпадает с предыдущим.
4. Повторная sheet publication не выполняет второй write.

### S5. amoCRM недоступна

1. Все retry исчерпаны.
2. Sync получает failed/partial; cursor не двигается.
3. Current snapshot остаётся прежним.
4. Dashboard показывает stale banner и trace ID.
5. Google Sheets не изменяется.

### S6. Изменена рабочая Google-копия

1. Пользователь переставил столбцы или переименовал заголовок.
2. Fingerprint перед публикацией не совпал.
3. Google write не вызывается.
4. Publication получает blocked, alert critical, предыдущие значения сохраняются.

### S7. Попытка записи в amoCRM

1. Ошибочный код формирует PATCH/POST business request.
2. `amoFetch` отклоняет его до сети.
3. Audit получает `denied` и `E_AMO_METHOD_DENIED`.
4. Тест и production alert делают нарушение видимым.
5. amoCRM не получает запрос.

### S8. Попытка записи в исходную таблицу

1. В target передан защищённый spreadsheet ID.
2. Denylist отклоняет ID до получения Google client.
3. Publication не создаёт сетевой вызов и возвращает `E_SHEET_PROTECTED`.

---

## 12. Граф зависимостей

```text
M1 Access ───────────────┬──────────────┐
                        ↓              ↓
M2 OAuth → M3 Config → M4 Sync → M5 Normalize → M6 Metrics → M7 API → M8 UI
                                      │             │
                                      └─────────────┴→ M9 Google Sheets
M10 Observability ← события и состояния всех модулей
```

Порядок реализации не меняется: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9, а M10 добавляется вертикальными срезами с первого модуля.

## 13. План спецификаций фич

Каждая строка становится отдельным файлом `specs/features/NN-*.md` перед своей реализацией:

| № | Фича | Проверяемый результат |
|---:|---|---|
| 00 | Skeleton и safety harness | denylist/GET-only тесты падают при запрещённом method/ID |
| 01 | Auth и RLS | роли видят только разрешённые rows |
| 02 | OAuth connection | внешний аккаунт подтверждён, токены не попадают клиенту |
| 03 | Metadata/config | pipeline/status IDs валидированы и версионированы |
| 04 | Raw sync | backfill и повторный run без дублей |
| 05 | Normalization | stage history и quality issues воспроизводимы |
| 06 | Metrics snapshot | golden-когорты сходятся до сделки и копейки |
| 07 | Dashboard API | один snapshot version во всех блоках и role filtering |
| 08 | Dashboard UI | шесть экранов и четыре состояния проходят visual E2E |
| 09 | Google Sheets copy | protected ID отклонён, копия обновляется идемпотентно |
| 10 | Shadow reconciliation | 7–14 дней без необъяснённых расхождений |
| 11 | Production hardening | backup restore, alerts, runbook и SLO checks |

## 14. Приёмочные критерии MVP

MVP считается готовым к production только если выполнены все условия:

1. Прикладной audit содержит только GET к amoCRM; OAuth POST существует только для token exchange/refresh.
2. Автоматический тест доказывает, что исходный spreadsheet ID нельзя использовать как target.
3. Initial backfill и повторный backfill дают одинаковые unique counts и snapshot checksum.
4. Golden-набор из `METRICS_CATALOG.md` проходит с расхождением 0 сделок и 0 ₽/копеек.
5. В течение теневого периода 7–14 дней каждое расхождение с ручной таблицей объяснено и классифицировано; необъяснённых расхождений нет.
6. Partial/failed sync не меняет current snapshot и Google-копию.
7. Для любой KPI-цифры drill-down возвращает сделки, сумма которых совпадает с агрегатом.
8. Manager не может получить данные другого manager через UI, URL или прямой API.
9. Google publisher блокируется при изменении layout fingerprint и сохраняет предыдущие значения.
10. Backup успешно восстановлен в изолированную БД в пределах 4 часов.
11. Пользовательские экраны проходят Playwright на 375, 768, 1024, 1280 и 1440 px.
12. Получено письменное подтверждение по сохранению поддержки amoCRM при внешней OAuth-интеграции.

## 15. Что требуется со стороны владельца РЕАЛ ДВА

Без передачи секретов в этот репозиторий:

1. создать внешнюю OAuth-интеграцию amoCRM и зарегистрировать production/staging Redirect URI;
2. предоставить client ID и client secret через secret store при настройке окружения;
3. установить интеграцию администратором аккаунта `555151.amocrm.ru`;
4. подтвердить найденные через API ID воронки, application status, won status и source field;
5. утвердить первичный справочник каналов;
6. создать копию исходной Google-таблицы и расшарить service account только эту копию;
7. предоставить планы отдела/менеджеров или подтвердить импорт планов из копии;
8. назвать email пользователей и их роли;
9. указать обязательные email для критических alerts;
10. получить письменный ответ поддержки amoCRM о внешней интеграции;
11. ежедневно в теневой период подтверждать или объяснять reconciliation differences.

## 16. Явно исключено из этой спецификации

- изменение любого объекта amoCRM;
- настройка Digital Pipeline, роботов, webhook или задач;
- приватная интеграция amoCRM;
- запись в исходную Google-таблицу;
- перенос рабочих коммуникаций менеджеров в новый интерфейс;
- отправка сообщений клиентам;
- AI-прогнозы и рекомендации;
- рекламные кабинеты и расходы;
- мультиаккаунт amoCRM;
- нативное мобильное приложение.

Расширение любого пункта требует отдельной утверждённой feature spec по `SPEC_TEMPLATE.md`.
