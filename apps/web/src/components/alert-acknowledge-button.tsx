"use client";

import React, { useState } from "react";

type ApiBody = Readonly<{ error?: Readonly<{ message?: string }> }>;

/**
 * Acknowledging records who saw the alert. It deliberately does not resolve
 * the alert: the underlying condition disappears on its own or not at all.
 */
export function AlertAcknowledgeButton({
  alertId,
  disabled,
}: Readonly<{ alertId: string; disabled: boolean }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (disabled) return <span className="muted">—</span>;

  async function acknowledge(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/alerts/${alertId}/acknowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiBody;
        setError(body.error?.message ?? "Не удалось отметить оповещение");
        return;
      }
      window.location.reload();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button disabled={pending} onClick={acknowledge} type="button">
        {pending ? "Отмечаем…" : "Я увидел"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </>
  );
}
