export type AppErrorCode =
  | "E_AUTH_REQUIRED"
  | "E_RATE_LIMITED"
  | "E_FORBIDDEN"
  | "E_VALIDATION"
  | "E_NOT_FOUND"
  | "E_CONFLICT"
  | "E_CONFIG_INCOMPLETE"
  | "E_AMO_AUTH"
  | "E_AMO_RATE_LIMIT"
  | "E_AMO_UPSTREAM"
  | "E_AMO_METHOD_DENIED"
  | "E_AMO_PATH_DENIED"
  | "E_SYNC_LOCKED"
  | "E_SYNC_FENCE_LOST"
  | "E_SYNC_PARTIAL"
  | "E_DATA_QUALITY_BLOCK"
  | "E_SHEET_PROTECTED"
  | "E_SHEET_LAYOUT_MISMATCH"
  | "E_SHEET_UPSTREAM"
  | "E_DB"
  | "E_INTERNAL";

const defaultMessages: Record<AppErrorCode, string> = {
  E_AUTH_REQUIRED: "Требуется вход",
  E_RATE_LIMITED: "Слишком много попыток. Попробуйте позже",
  E_FORBIDDEN: "Доступ запрещён",
  E_VALIDATION: "Проверьте параметры запроса",
  E_NOT_FOUND: "Объект не найден",
  E_CONFLICT: "Данные уже изменились. Обновите страницу",
  E_CONFIG_INCOMPLETE: "Настройка не завершена",
  E_AMO_AUTH: "Подключение к amoCRM требует внимания",
  E_AMO_RATE_LIMIT: "amoCRM временно ограничила запросы",
  E_AMO_UPSTREAM: "amoCRM временно недоступна",
  E_AMO_METHOD_DENIED: "Метод amoCRM запрещён",
  E_AMO_PATH_DENIED: "Адрес amoCRM запрещён",
  E_SYNC_LOCKED: "Синхронизация уже выполняется",
  E_SYNC_FENCE_LOST: "Синхронизация потеряла эксклюзивную блокировку",
  E_SYNC_PARTIAL: "Синхронизация завершилась не полностью",
  E_DATA_QUALITY_BLOCK: "Проверка качества данных не пройдена",
  E_SHEET_PROTECTED: "Исходная таблица защищена от записи",
  E_SHEET_LAYOUT_MISMATCH: "Структура таблицы изменилась",
  E_SHEET_UPSTREAM: "Google Sheets временно недоступна",
  E_DB: "Ошибка хранилища данных",
  E_INTERNAL: "Внутренняя ошибка",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly safeMessage: string;

  constructor(code: AppErrorCode, status: number, safeMessage?: string) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage ?? defaultMessages[code];
  }
}
