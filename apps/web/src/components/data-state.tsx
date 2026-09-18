import React from "react";

import type { ReactNode } from "react";

import type { DataStateKind } from "../lib/dashboard/data-state";

export type DataStateProps = Readonly<{
  kind: DataStateKind;
  /** Shown above the content when the newest refresh failed. */
  stale?: boolean;
  errorCode?: string | null;
  traceId?: string | null;
  emptyMessage?: string;
  retryHref?: string;
  skeletonRows?: number;
  children?: ReactNode;
}>;

const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  E_CONFIG_INCOMPLETE: "Настройка не завершена: утверждённого снимка ещё нет.",
  E_FORBIDDEN: "Недостаточно прав для этого среза.",
  E_VALIDATION: "Проверьте параметры фильтра.",
  E_CONFLICT: "Данные обновились. Начните просмотр заново.",
};

/**
 * The four states every screen must have, plus the stale case: content stays
 * on screen when a refresh fails, with an explicit notice instead of zeros.
 */
export function DataState({
  kind,
  stale = false,
  errorCode = null,
  traceId = null,
  emptyMessage = "За выбранный период данных нет.",
  retryHref,
  skeletonRows = 3,
  children,
}: DataStateProps) {
  if (kind === "loading") {
    return (
      <div className="data-state" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Загрузка данных</span>
        {Array.from({ length: skeletonRows }, (_, index) => (
          <div className="skeleton-row" key={index} />
        ))}
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="data-state data-state-error" role="alert">
        <p>{ERROR_MESSAGE[errorCode ?? ""] ?? "Не удалось загрузить данные."}</p>
        {traceId ? <p className="trace-id">Идентификатор запроса: {traceId}</p> : null}
        {retryHref ? <a href={retryHref}>Повторить</a> : null}
      </div>
    );
  }

  if (kind === "empty") {
    return (
      <div className="data-state data-state-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {stale ? (
        <p className="stale-notice" role="status">
          Показаны последние доступные данные: обновление не удалось
          {traceId ? ` (запрос ${traceId})` : ""}.
        </p>
      ) : null}
      {children}
    </>
  );
}
