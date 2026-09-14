"use client";

import React, { useState } from "react";

import {
  isAmoConnectionActive,
  type PublicAmoConnectionStatus,
} from "../lib/amo/public-status";

type ApiBody = {
  data?: { authorizationUrl?: string };
  error?: { message?: string };
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readApi(response: Response): Promise<ApiBody> {
  return (await response.json().catch(() => ({}))) as ApiBody;
}

export function AmoIntegrationManager({
  initialStatus,
}: Readonly<{ initialStatus: PublicAmoConnectionStatus | null }>) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<"start" | "refresh" | "disconnect" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startConnection() {
    setPending("start");
    setError(null);
    try {
      const response = await fetch("/api/integrations/amo/start", { method: "POST" });
      const body = await readApi(response);
      if (!response.ok || !body.data?.authorizationUrl) {
        setError(body.error?.message ?? "Не удалось начать подключение");
        return;
      }
      window.location.assign(body.data.authorizationUrl);
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(null);
    }
  }

  async function updateConnection(
    action: "refresh" | "disconnect",
    successMessage: string,
  ) {
    setPending(action);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/amo/${action}`, {
        method: "POST",
      });
      const body = await readApi(response);
      if (!response.ok) {
        setError(body.error?.message ?? "Не удалось обновить подключение");
        return;
      }
      setMessage(successMessage);
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      try {
        const statusResponse = await fetch("/api/integrations/amo/status");
        const statusBody = (await readApi(statusResponse)) as ApiBody & {
          data?: PublicAmoConnectionStatus | null;
        };
        if (statusResponse.ok) setStatus(statusBody.data ?? null);
      } catch {
        // Keep the last safe projection when a status reload is unavailable.
      }
      setPending(null);
    }
  }

  return (
    <section className="panel amo-integration" aria-labelledby="amo-title">
      <div className="integration-heading">
        <div>
          <h2 id="amo-title">amoCRM</h2>
          <p className="muted">Подключение ограничено аккаунтом 555151.amocrm.ru.</p>
        </div>
        <span className={`status-chip${status?.status === "active" ? "" : " inactive"}`}>
          {status?.status ?? "не подключено"}
        </span>
      </div>

      {status ? (
        <dl className="integration-details">
          <div><dt>Account ID</dt><dd>{status.accountId}</dd></div>
          <div><dt>Поддомен</dt><dd>{status.subdomain}</dd></div>
          <div><dt>Токен действует до</dt><dd>{formatDate(status.expiresAt)}</dd></div>
          <div><dt>Последняя проверка</dt><dd>{formatDate(status.lastCheckedAt)}</dd></div>
        </dl>
      ) : (
        <p className="muted">Интеграция пока не подключена.</p>
      )}

      <div className="card-actions">
        <button className="button" disabled={pending !== null} onClick={startConnection} type="button">
          {pending === "start" ? "Открываем…" : status ? "Переподключить" : "Подключить"}
        </button>
        <button className="button button-secondary" disabled={!isAmoConnectionActive(status) || pending !== null} onClick={() => updateConnection("refresh", "Проверка чтения завершена")} type="button">
          {pending === "refresh" ? "Проверяем…" : "Проверить чтение"}
        </button>
        <button className="button button-danger" disabled={!isAmoConnectionActive(status) || pending !== null} onClick={() => updateConnection("disconnect", "Интеграция отключена. Последний снимок сохранён")} type="button">
          {pending === "disconnect" ? "Отключаем…" : "Отключить"}
        </button>
      </div>
      {error ? <p aria-live="polite" className="form-error" role="alert">{error}</p> : null}
      {message ? <p aria-live="polite" className="form-success">{message}</p> : null}
    </section>
  );
}
