"use client";

import React, { useState } from "react";

type ApiBody = Readonly<{
  error?: Readonly<{ message?: string }>;
}>;

export function buildManualSyncRequest(confirmRecent: boolean): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmRecent }),
  };
}

export function SyncTrigger({ recentRun }: Readonly<{ recentRun: boolean }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    const confirmRecent = recentRun
      ? window.confirm("Последний запуск начался менее минуты назад. Запустить ещё раз?")
      : false;
    if (recentRun && !confirmRecent) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/sync-runs",
        buildManualSyncRequest(confirmRecent),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiBody;
        setError(body.error?.message ?? "Не удалось запустить синхронизацию");
        return;
      }
      window.location.reload();
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sync-trigger">
      {recentRun ? (
        <p className="sync-recent">Последний запуск начался менее минуты назад</p>
      ) : null}
      <button className="button" disabled={pending} onClick={start} type="button">
        {pending ? "Запускаем…" : "Синхронизировать"}
      </button>
      {error ? <p aria-live="polite" className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
