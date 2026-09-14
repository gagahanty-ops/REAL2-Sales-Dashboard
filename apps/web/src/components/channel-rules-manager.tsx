"use client";

import React, { useState } from "react";

export type ChannelRuleEdit = Readonly<{
  priority: number;
  matchType: "source_field_exact" | "tag_exact" | "integration_source_exact";
  matchValue: string;
  normalizedChannel:
    | "phone_uis"
    | "whatsapp"
    | "avito"
    | "instagram"
    | "site"
    | "telegram"
    | "max"
    | "unknown";
}>;

type Candidate = Readonly<{
  pipelineId: number;
  applicationStatusId: number;
  wonStatusId: number;
  channelFieldId: number | null;
}>;

type InitialConfig = Readonly<{
  configId: string;
  version: number;
  candidate: Candidate;
  channelRules: readonly ChannelRuleEdit[];
}>;

type Validation = Readonly<{
  valid: boolean;
  metadataChecksum: string;
  reasons?: readonly string[];
  warnings?: readonly string[];
  requiresNameConfirmation?: boolean;
}>;

type ApiBody<T> = Readonly<{
  data?: T;
  error?: Readonly<{ message?: string }>;
}>;

type EditableRow = ChannelRuleEdit & Readonly<{ rowId: string }>;

const matchTypes: readonly ChannelRuleEdit["matchType"][] = [
  "source_field_exact",
  "tag_exact",
  "integration_source_exact",
];

const channels: readonly ChannelRuleEdit["normalizedChannel"][] = [
  "phone_uis",
  "whatsapp",
  "avito",
  "instagram",
  "site",
  "telegram",
  "max",
  "unknown",
];

const sourceOrder: Record<ChannelRuleEdit["matchType"], number> = {
  source_field_exact: 0,
  tag_exact: 1,
  integration_source_exact: 2,
};

async function readApi<T>(response: Response): Promise<ApiBody<T>> {
  return (await response.json().catch(() => ({}))) as ApiBody<T>;
}

export function validateChannelRuleEdits(
  rules: readonly ChannelRuleEdit[],
): string | null {
  if (rules.length === 0) return "Добавьте хотя бы одно точное правило";
  if (
    rules.some(
      (rule) =>
        !Number.isInteger(rule.priority) ||
        rule.priority < 1 ||
        rule.priority > 1_000,
    )
  ) {
    return "Приоритет должен быть целым числом от 1 до 1000";
  }
  if (rules.some((rule) => rule.matchValue.trim().length === 0)) {
    return "Точное значение не может быть пустым";
  }

  const priorities = rules.map((rule) => rule.priority);
  if (new Set(priorities).size !== priorities.length) {
    return "Каждому правилу нужен уникальный приоритет";
  }
  const exactKeys = rules.map(
    (rule) => `${rule.matchType}\u0000${rule.matchValue}`,
  );
  if (new Set(exactKeys).size !== exactKeys.length) {
    return "Тип источника и точное значение не должны повторяться";
  }

  const orderedSources = [...rules]
    .sort((left, right) => left.priority - right.priority)
    .map((rule) => sourceOrder[rule.matchType]);
  if (
    orderedSources.some(
      (order, index) => index > 0 && order < orderedSources[index - 1]!,
    )
  ) {
    return "Порядок должен быть: поле источника, затем теги, затем интеграции";
  }
  return null;
}

export function buildChannelActivationPayload(input: Readonly<{
  configId: string;
  candidate: Candidate;
  channelRules: readonly ChannelRuleEdit[];
  metadataChecksum: string;
  confirmNameChanges: boolean;
}>) {
  return {
    candidate: input.candidate,
    channelRules: input.channelRules,
    metadataChecksum: input.metadataChecksum,
    expectedActiveConfigId: input.configId,
    confirmNameChanges: input.confirmNameChanges,
  };
}

export function ChannelRulesManager({
  initialConfig,
}: Readonly<{ initialConfig: InitialConfig }>) {
  const [rows, setRows] = useState<readonly EditableRow[]>(
    initialConfig.channelRules.map((rule, index) => ({
      ...rule,
      rowId: `initial-${index}`,
    })),
  );
  const [activeConfigId, setActiveConfigId] = useState(initialConfig.configId);
  const [version, setVersion] = useState(initialConfig.version);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [confirmNameChanges, setConfirmNameChanges] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rules = rows.map((row) => ({
    priority: row.priority,
    matchType: row.matchType,
    matchValue: row.matchValue,
    normalizedChannel: row.normalizedChannel,
  }));

  function invalidateValidation() {
    setValidation(null);
    setConfirmNameChanges(false);
    setMessage(null);
  }

  function updateRow(rowId: string, change: Partial<ChannelRuleEdit>) {
    setRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...change } : row)),
    );
    invalidateValidation();
  }

  function addRule() {
    const nextPriority = Math.max(0, ...rows.map((row) => row.priority)) + 1;
    setRows((current) => [
      ...current,
      {
        rowId: `new-${Date.now()}-${current.length}`,
        priority: nextPriority,
        matchType: "source_field_exact",
        matchValue: "",
        normalizedChannel: "unknown",
      },
    ]);
    invalidateValidation();
  }

  function removeRule(rowId: string) {
    setRows((current) => current.filter((row) => row.rowId !== rowId));
    invalidateValidation();
  }

  async function validateAndActivate() {
    const editError = validateChannelRuleEdits(rules);
    if (editError) {
      setError(editError);
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const validationResponse = await fetch("/api/config/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initialConfig.candidate),
      });
      const validationBody = await readApi<Validation>(validationResponse);
      if (!validationResponse.ok || !validationBody.data) {
        setError(validationBody.error?.message ?? "Проверка конфигурации не выполнена");
        return;
      }
      setValidation(validationBody.data);
      if (!validationBody.data.valid) {
        setError("Активная воронка больше не подтверждается live-метаданными amoCRM");
        return;
      }
      if (
        validationBody.data.requiresNameConfirmation &&
        !confirmNameChanges
      ) {
        setMessage("Имена изменились при прежних ID. Подтвердите изменения и повторите активацию.");
        return;
      }

      const activationResponse = await fetch("/api/config/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildChannelActivationPayload({
            configId: activeConfigId,
            candidate: initialConfig.candidate,
            channelRules: rules,
            metadataChecksum: validationBody.data.metadataChecksum,
            confirmNameChanges,
          }),
        ),
      });
      const activationBody = await readApi<{
        configId: string;
        version: number;
      }>(activationResponse);
      if (!activationResponse.ok || !activationBody.data) {
        setError(
          activationResponse.status === 409
            ? "Конфигурация уже изменилась. Обновите страницу и повторите проверку."
            : activationBody.error?.message ?? "Правила не активированы",
        );
        return;
      }
      setActiveConfigId(activationBody.data.configId);
      setVersion(activationBody.data.version);
      setValidation(null);
      setConfirmNameChanges(false);
      setMessage(
        `Версия ${activationBody.data.version} активирована. Пересчёт поставлен в очередь; текущий снимок не изменён.`,
      );
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="channel-rules-title">
      <div className="integration-heading">
        <div>
          <h2 id="channel-rules-title">Точные правила · версия {version}</h2>
          <p className="muted">
            Значение сравнивается целиком. Подстроки и свободный текст не угадываются;
            конфликт остаётся unknown.
          </p>
        </div>
        <button className="button button-secondary" onClick={addRule} type="button">
          Добавить правило
        </button>
      </div>
      <div className="config-table-wrap">
        <table className="config-table channel-rules-table">
          <thead>
            <tr>
              <th>Приоритет</th>
              <th>Источник доказательства</th>
              <th>Точное значение</th>
              <th>Канал</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {rows.map((rule) => (
              <tr key={rule.rowId}>
                <td>
                  <input
                    aria-label={`Приоритет ${rule.matchValue || "нового правила"}`}
                    min={1}
                    max={1_000}
                    onChange={(event) =>
                      updateRow(rule.rowId, { priority: Number(event.target.value) })
                    }
                    type="number"
                    value={rule.priority}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Источник ${rule.matchValue || "нового правила"}`}
                    onChange={(event) =>
                      updateRow(rule.rowId, {
                        matchType: event.target.value as ChannelRuleEdit["matchType"],
                      })
                    }
                    value={rule.matchType}
                  >
                    {matchTypes.map((matchType) => (
                      <option key={matchType} value={matchType}>{matchType}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label="Точное значение"
                    maxLength={500}
                    onChange={(event) =>
                      updateRow(rule.rowId, { matchValue: event.target.value })
                    }
                    type="text"
                    value={rule.matchValue}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Канал ${rule.matchValue || "нового правила"}`}
                    onChange={(event) =>
                      updateRow(rule.rowId, {
                        normalizedChannel:
                          event.target.value as ChannelRuleEdit["normalizedChannel"],
                      })
                    }
                    value={rule.normalizedChannel}
                  >
                    {channels.map((channel) => (
                      <option key={channel} value={channel}>{channel}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="button button-danger button-compact"
                    onClick={() => removeRule(rule.rowId)}
                    type="button"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {validation?.requiresNameConfirmation ? (
        <label className="confirmation-field">
          <input
            checked={confirmNameChanges}
            onChange={(event) => setConfirmNameChanges(event.target.checked)}
            type="checkbox"
          />
          Подтверждаю новые имена при сохранённых ID воронки и этапов
        </label>
      ) : null}
      <div className="card-actions config-actions">
        <button
          className="button"
          disabled={pending}
          onClick={validateAndActivate}
          type="button"
        >
          {pending ? "Проверяем…" : "Проверить и активировать"}
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" aria-live="polite">{message}</p> : null}
    </section>
  );
}
