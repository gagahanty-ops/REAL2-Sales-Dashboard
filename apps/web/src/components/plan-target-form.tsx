"use client";

import React, { useState } from "react";

type ApiBody = Readonly<{ error?: Readonly<{ message?: string }> }>;

export type PlanTargetInput = Readonly<{
  month: string;
  managerKey: string;
  metricKey: string;
  targetValue: string;
}>;

export function planTargetRequest(input: PlanTargetInput): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  };
}

/** A new target closes the previous row; history is never overwritten. */
export function PlanTargetForm({
  managers,
}: Readonly<{ managers: readonly Readonly<{ value: string; label: string }>[] }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const month = String(data.get("month") ?? "");
    const input: PlanTargetInput = {
      month: month.length === 7 ? `${month}-01` : month,
      managerKey: String(data.get("managerKey") ?? "all"),
      metricKey: String(data.get("metricKey") ?? "revenue"),
      targetValue: String(data.get("targetValue") ?? ""),
    };

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/plans", planTargetRequest(input));
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiBody;
        setError(body.error?.message ?? "Не удалось сохранить план");
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
    <form className="filter-bar" onSubmit={submit}>
      <fieldset>
        <legend>Новая цель</legend>
        <label htmlFor="plan-month">Месяц</label>
        <input id="plan-month" name="month" required type="month" />

        <label htmlFor="plan-manager">Кому</label>
        <select defaultValue="all" id="plan-manager" name="managerKey">
          <option value="all">Отдел целиком</option>
          {managers.map((manager) => (
            <option key={manager.value} value={manager.value}>
              {manager.label}
            </option>
          ))}
        </select>

        <label htmlFor="plan-metric">Показатель</label>
        <select defaultValue="revenue" id="plan-metric" name="metricKey">
          <option value="leads_created">Лиды</option>
          <option value="applications">Заявки</option>
          <option value="payments">Оплаты</option>
          <option value="revenue">Выручка</option>
        </select>

        <label htmlFor="plan-target">Цель</label>
        <input
          id="plan-target"
          name="targetValue"
          pattern="\d+\.\d{2}"
          placeholder="1000000.00"
          required
          title="Число с двумя знаками после точки, например 1000000.00"
        />
      </fieldset>
      <button disabled={pending} type="submit">
        {pending ? "Сохраняем…" : "Сохранить цель"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}
