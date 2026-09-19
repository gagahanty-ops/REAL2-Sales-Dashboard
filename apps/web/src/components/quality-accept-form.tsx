"use client";

import React, { useState } from "react";

type ApiBody = Readonly<{ error?: Readonly<{ message?: string }> }>;

export function acceptIssueRequest(reason: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  };
}

/**
 * Accepting a known exception requires a written reason: the record must say
 * why a human decided this issue is acceptable, not merely that somebody
 * clicked.
 */
export function QualityAcceptForm({
  issueId,
  acceptable,
}: Readonly<{ issueId: string; acceptable: boolean }>) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!acceptable) {
    return <span className="muted">Этот код принять нельзя</span>;
  }

  async function accept(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/quality/issues/${issueId}/accept`,
        acceptIssueRequest(reason),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiBody;
        setError(body.error?.message ?? "Не удалось принять проблему");
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
    <form className="inline-form" onSubmit={accept}>
      <label className="visually-hidden" htmlFor={`reason-${issueId}`}>
        Причина принятия
      </label>
      <input
        id={`reason-${issueId}`}
        maxLength={500}
        minLength={10}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Причина, не короче 10 символов"
        required
        value={reason}
      />
      <button disabled={pending} type="submit">
        {pending ? "Принимаем…" : "Принять"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}
