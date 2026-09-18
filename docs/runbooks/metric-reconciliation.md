# Сверка метрик REAL2

Этот runbook отвечает на вопрос «почему в отчёте именно это число» и
доводит его до конкретной сделки amoCRM. Все шаги только читают данные.
Ни один шаг не меняет amoCRM, сырой журнал и утверждённые снимки.

## Что с чем сверяется

| Слой | Где лежит | Чем подтверждается |
| --- | --- | --- |
| Сырые страницы | `raw_amo_objects`, `raw_amo_events` | контрольная сумма страницы |
| Нормализованный слой | `leads`, `lead_stage_events`, `lead_milestones` | прогон нормализации |
| Метрики | `metric_cells`, `metric_lead_facts` | контрольная сумма снимка |

Все бизнес-даты — календарный день `Europe/Moscow`. Показатель всегда
относится к дате создания сделки, даже если заявка и оплата случились позже.

## Шаг 1. Зафиксируйте снимок

```bash
curl --fail-with-body http://127.0.0.1:3000/api/snapshots/current
```

Запишите `version`, `checksum`, `syncRunId` и `sourceFreshAt`. Дальше
сверяйте только этот снимок: числа в нём неизменяемы.

## Шаг 2. Разложите число отчёта на сделки

Итог дня — строка `manager_key = 'all'`, `channel_key = 'all'`. Чтобы получить
список сделок за этот день, возьмите факты того же снимка:

```sql
select amo_lead_id, manager_key, channel_key, currently_won, price_rub, amo_url
from metric_lead_facts
where snapshot_id = :snapshot_id and report_date = :report_date
order by amo_lead_id;
```

Число строк обязано совпасть с `leads_created` итоговой строки того же дня.
Если не совпало — снимок собран с дефектом, и его нельзя публиковать:
`validateSnapshot` вернёт `cross_foot_mismatch` или `facts_do_not_match_cells`.

## Шаг 3. Проверьте одну сделку

```sql
select created_date, current_status_id, current_responsible_user_id,
  normalized_channel, price_rub
from leads
where account_id = :account_id and amo_lead_id = :amo_lead_id;

select application_at, won_at, currently_won
from lead_milestones
where account_id = :account_id and amo_lead_id = :amo_lead_id;

select amo_event_id, from_status_id, to_status_id, occurred_at
from lead_stage_events
where account_id = :account_id and amo_lead_id = :amo_lead_id
order by occurred_at, amo_event_id;
```

Типичные объяснения расхождений:

- **сделка не попала в заявки** — нет события перехода в этап заявки;
  текущий этап сам по себе заявку не подтверждает, для такого случая заводится
  `missing_stage_history`;
- **сделка не попала в оплаты** — либо нет подтверждённого `won_at`, либо она
  уже вернулась в открытый этап: `currently_won = false`;
- **оплата есть, выручки нет** — у выигранной сделки нет корректной суммы,
  это `won_without_valid_price`;
- **сделка в «unknown»** — значение источника не сопоставлено правилом;
  правила версионируются, пересчёт делает новая версия, сырой журнал не меняется;
- **сделка вообще отсутствует** — она в другой воронке (`out_of_scope_pipeline`)
  или её снимок отклонён как некорректный.

## Шаг 4. Сверьте с amoCRM вручную

Откройте `amo_url` из факта. Сверяйте только четыре поля: дату создания,
текущий этап, ответственного и сумму. Отличие в дате создания почти всегда
означает часовой пояс: в отчёте день считается по Москве.

## Шаг 5. Если данные в amoCRM изменились

Дождитесь следующей успешной синхронизации и нового снимка. Утверждённый
снимок не переписывается: расхождение объясняется сравнением двух версий,
а не правкой старой.

## Чего делать нельзя

- менять строки `metric_cells`, `metric_lead_facts`, `stage_snapshot_rows` и
  реквизиты снимка: триггеры базы это запрещают, и запрет не обходится;
- принимать `missing_stage_history` и `source_api_error` — политика качества
  их не допускает;
- публиковать снимок, у которого `validateSnapshot` вернул хотя бы одну
  причину отказа.
