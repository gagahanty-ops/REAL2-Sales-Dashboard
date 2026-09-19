/**
 * Alerts are read by a duty operator, not by the developer who named the code.
 * An unknown code stays visible as-is: a new condition must never be hidden
 * behind a generic phrase.
 */
const CODE_LABEL: Readonly<Record<string, string>> = {
  // Operational conditions from the health check.
  database_unreachable: "База данных недоступна",
  snapshot_missing: "Нет утверждённого снимка",
  sync_stale: "Синхронизация отстала",
  sync_failing: "Синхронизация падает",
  quality_blocking: "Качество данных блокирует публикацию",
  configuration_incomplete: "Конфигурация не заполнена",
  amo_token_expiring: "Истекает токен amoCRM",
  sheet_layout_drift: "Раскладка таблицы изменилась",
  sheet_checksum_mismatch: "Контрольная сумма публикации не сошлась",
  // Publication failures classified by the Google client.
  E_SHEET_PROTECTED: "Запрет: защищённая таблица",
  E_SHEET_LAYOUT_MISMATCH: "Раскладка таблицы не совпала",
  E_SHEET_UPSTREAM: "Google ответил ошибкой",
  E_CONFIG_INCOMPLETE: "Публикация не настроена",
  E_INTERNAL: "Внутренняя ошибка публикации",
};

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  operations: "Эксплуатация",
  metric_snapshot: "Снимок метрик",
  sheet_publication: "Публикация в таблицу",
};

export function alertCodeLabel(code: string): string {
  return CODE_LABEL[code] ?? code;
}

export function alertSourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}
