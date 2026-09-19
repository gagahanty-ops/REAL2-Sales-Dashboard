"use client";

import React, { useState } from "react";

type ApiBody = Readonly<{ error?: Readonly<{ message?: string }> }>;

export type SheetTargetView = Readonly<{
  id: string;
  spreadsheetId: string;
  expectedTitle: string;
  status: "draft" | "validated" | "active" | "disabled";
}>;

/** The default mapping an administrator can start from and then edit. */
export const DEFAULT_MAPPING_TEMPLATE = JSON.stringify(
  [
    { reportKind: "channels_daily", logicalField: "report_date", sheetName: "каналы", rangeA1: "A2:A32", valueType: "date" },
    { reportKind: "channels_daily", logicalField: "channel", sheetName: "каналы", rangeA1: "B2:B32", valueType: "text" },
    { reportKind: "channels_daily", logicalField: "leads_created", sheetName: "каналы", rangeA1: "C2:C32", valueType: "integer" },
    { reportKind: "channels_daily", logicalField: "applications", sheetName: "каналы", rangeA1: "D2:D32", valueType: "integer" },
    { reportKind: "channels_daily", logicalField: "payments", sheetName: "каналы", rangeA1: "E2:E32", valueType: "integer" },
    { reportKind: "channels_daily", logicalField: "revenue", sheetName: "каналы", rangeA1: "F2:F32", valueType: "money" },
    { reportKind: "plan_fact", logicalField: "metric", sheetName: "план", rangeA1: "A2:A6", valueType: "text" },
    { reportKind: "plan_fact", logicalField: "plan_target", sheetName: "план", rangeA1: "B2:B6", valueType: "text" },
    { reportKind: "plan_fact", logicalField: "actual_value", sheetName: "план", rangeA1: "C2:C6", valueType: "text" },
    { reportKind: "plan_fact", logicalField: "completion_pct", sheetName: "план", rangeA1: "D2:D6", valueType: "percent" },
  ],
  null,
  2,
);

async function call(url: string, init: RequestInit): Promise<string | null> {
  const response = await fetch(url, init);
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  return body.error?.message ?? "Операция не выполнена";
}

/**
 * Registers a manually created copy, saves its explicit ranges, validates the
 * real layout and activates the target. None of these steps enables
 * publication: that switch stays a separate manual decision.
 */
export function SheetTargetManager({
  targets,
}: Readonly<{ targets: readonly SheetTargetView[] }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mappings, setMappings] = useState(DEFAULT_MAPPING_TEMPLATE);

  async function run(action: () => Promise<string | null>, done: string): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const failure = await action();
      if (failure) {
        setError(failure);
        return;
      }
      setMessage(done);
      window.location.reload();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setPending(false);
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        call("/api/sheets/targets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spreadsheetId: String(data.get("spreadsheetId") ?? "").trim(),
            expectedTitle: String(data.get("expectedTitle") ?? "").trim(),
          }),
        }),
      "Копия зарегистрирована",
    );
  }

  async function saveMappings(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappings);
    } catch {
      setError("Диапазоны должны быть корректным JSON");
      return;
    }
    await run(
      () =>
        call("/api/sheets/mappings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetId: String(data.get("targetId") ?? ""), mappings: parsed }),
        }),
      "Диапазоны сохранены",
    );
  }

  const editable = targets.filter((target) => target.status !== "disabled");

  return (
    <div className="stacked-forms">
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}

      <form className="filter-bar" onSubmit={register}>
        <fieldset>
          <legend>Регистрация копии</legend>
          <label htmlFor="sheet-id">Идентификатор копии</label>
          <input
            id="sheet-id"
            name="spreadsheetId"
            pattern="[A-Za-z0-9_-]{20,200}"
            placeholder="1AbC…"
            required
            title="Идентификатор из адреса таблицы"
          />
          <label htmlFor="sheet-title">Точное название копии</label>
          <input id="sheet-title" name="expectedTitle" required />
        </fieldset>
        <button disabled={pending} type="submit">
          Зарегистрировать
        </button>
      </form>

      {editable.length > 0 ? (
        <form className="filter-bar" onSubmit={saveMappings}>
          <fieldset>
            <legend>Диапазоны</legend>
            <label htmlFor="mapping-target">Копия</label>
            <select id="mapping-target" name="targetId">
              {editable.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.expectedTitle} ({target.status})
                </option>
              ))}
            </select>
            <label htmlFor="mapping-json">Соответствие полей и диапазонов</label>
            <textarea
              id="mapping-json"
              onChange={(event) => setMappings(event.target.value)}
              rows={10}
              value={mappings}
            />
          </fieldset>
          <button disabled={pending} type="submit">
            Сохранить диапазоны
          </button>
        </form>
      ) : null}

      {editable.length > 0 ? (
        <div className="stacked-forms">
          <h3>Проверка и активация</h3>
          {editable.map((target) => (
            <p key={target.id}>
              {target.expectedTitle} — {target.status}{" "}
              <button
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      call(`/api/sheets/targets/${target.id}/validate`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: "{}",
                      }),
                    "Раскладка проверена",
                  )}
                type="button"
              >
                Проверить раскладку
              </button>{" "}
              <button
                disabled={pending || target.status !== "validated"}
                onClick={() =>
                  run(
                    () =>
                      call(`/api/sheets/targets/${target.id}/activate`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: "{}",
                      }),
                    "Копия активирована",
                  )}
                type="button"
              >
                Активировать
              </button>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
