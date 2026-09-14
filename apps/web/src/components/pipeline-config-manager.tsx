"use client";

import { useEffect, useMemo, useState } from "react";

type Discovery = Readonly<{
  pipelines: readonly Readonly<{
    id: number;
    name: string;
    statuses: readonly Readonly<{ id: number; name: string }>[];
  }>[];
  leadCustomFields: readonly Readonly<{ id: number; name: string }>[];
}>;

type ChannelRule = Readonly<{
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

type Validation = Readonly<{
  valid: boolean;
  metadataChecksum: string;
  reasons?: readonly string[];
}>;

type ApiBody<T> = {
  data?: T;
  error?: { message?: string };
};

const expectedApplicationName = "Завершение (самовывоз или доставка)";
const expectedWonName = "Успешно реализовано";

async function readApi<T>(response: Response): Promise<ApiBody<T>> {
  return (await response.json().catch(() => ({}))) as ApiBody<T>;
}

export function PipelineConfigManager({
  initialChannelRules,
}: Readonly<{ initialChannelRules: readonly ChannelRule[] }>) {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [pending, setPending] = useState<"discovery" | "validate" | "activate" | null>(
    "discovery",
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDiscovery() {
      try {
        const response = await fetch("/api/config/discovery");
        const body = await readApi<Discovery>(response);
        if (!response.ok || !body.data) {
          if (!cancelled) setError(body.error?.message ?? "Метаданные amoCRM недоступны");
          return;
        }

        const preferredPipeline =
          body.data.pipelines.find((pipeline) => pipeline.name === "РЕАЛ ДВА") ??
          body.data.pipelines[0];
        const applicationStatus = preferredPipeline?.statuses.find(
          (status) => status.name === expectedApplicationName,
        );
        const wonStatus = preferredPipeline?.statuses.find(
          (status) => status.name === expectedWonName,
        );
        const sourceField = body.data.leadCustomFields.find(
          (field) => field.name === "Источник сделки",
        );

        if (!cancelled) {
          setDiscovery(body.data);
          if (preferredPipeline && applicationStatus && wonStatus) {
            setCandidate({
              pipelineId: preferredPipeline.id,
              applicationStatusId: applicationStatus.id,
              wonStatusId: wonStatus.id,
              channelFieldId: sourceField?.id ?? null,
            });
          }
        }
      } catch {
        if (!cancelled) setError("Сервис временно недоступен. Повторите попытку");
      } finally {
        if (!cancelled) setPending(null);
      }
    }

    void loadDiscovery();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPipeline = useMemo(
    () => discovery?.pipelines.find((pipeline) => pipeline.id === candidate?.pipelineId),
    [candidate?.pipelineId, discovery],
  );

  function choosePipeline(pipelineId: number) {
    const pipeline = discovery?.pipelines.find((item) => item.id === pipelineId);
    setCandidate({
      pipelineId,
      applicationStatusId: pipeline?.statuses[0]?.id ?? 0,
      wonStatusId: pipeline?.statuses[1]?.id ?? pipeline?.statuses[0]?.id ?? 0,
      channelFieldId: candidate?.channelFieldId ?? null,
    });
    setValidation(null);
  }

  function updateCandidate(change: Partial<Candidate>) {
    setCandidate((current) => (current ? { ...current, ...change } : null));
    setValidation(null);
    setMessage(null);
  }

  async function validate() {
    if (!candidate) return;
    setPending("validate");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/config/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const body = await readApi<Validation>(response);
      if (!response.ok || !body.data) {
        setError(body.error?.message ?? "Проверка конфигурации не выполнена");
        return;
      }
      setValidation(body.data);
      if (!body.data.valid) {
        setError("ID и имена не подтверждены live-метаданными amoCRM");
      } else {
        setMessage("ID, имена и принадлежность этапов подтверждены");
      }
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(null);
    }
  }

  async function activate() {
    if (!candidate || !validation?.valid) return;
    setPending("activate");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/config/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate,
          channelRules: initialChannelRules,
          metadataChecksum: validation.metadataChecksum,
        }),
      });
      const body = await readApi<{ version: number }>(response);
      if (!response.ok || !body.data) {
        setError(body.error?.message ?? "Конфигурация не активирована");
        return;
      }
      setMessage(
        `Версия ${body.data.version} активирована. Пересчёт поставлен в очередь; текущий снимок не изменён.`,
      );
      setValidation(null);
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(null);
    }
  }

  if (pending === "discovery") {
    return <div className="panel skeleton" aria-label="Загрузка метаданных amoCRM" />;
  }

  if (!discovery || !candidate) {
    return (
      <section className="panel">
        <h2>Метаданные не подтверждены</h2>
        <p className="muted">
          Подключите amoCRM и убедитесь, что нужные воронка и этапы доступны через API.
        </p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <div className="settings-grid">
      <section className="panel" aria-labelledby="pipeline-config-title">
        <div className="integration-heading">
          <div>
            <h2 id="pipeline-config-title">Live-метаданные amoCRM</h2>
            <p className="muted">ID нельзя вводить вручную: доступны только значения ответа API.</p>
          </div>
          <span className={`status-chip${validation?.valid ? "" : " inactive"}`}>
            {validation?.valid ? "подтверждено" : "требует проверки"}
          </span>
        </div>
        <div className="config-form">
          <label className="field">
            Воронка
            <select
              onChange={(event) => choosePipeline(Number(event.target.value))}
              value={candidate.pipelineId}
            >
              {discovery.pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name} · {pipeline.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Этап заявки
            <select
              onChange={(event) => updateCandidate({ applicationStatusId: Number(event.target.value) })}
              value={candidate.applicationStatusId}
            >
              {selectedPipeline?.statuses.map((status) => (
                <option key={status.id} value={status.id}>{status.name} · {status.id}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Успешный статус
            <select
              onChange={(event) => updateCandidate({ wonStatusId: Number(event.target.value) })}
              value={candidate.wonStatusId}
            >
              {selectedPipeline?.statuses.map((status) => (
                <option key={status.id} value={status.id}>{status.name} · {status.id}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Поле источника
            <select
              onChange={(event) => updateCandidate({ channelFieldId: event.target.value ? Number(event.target.value) : null })}
              value={candidate.channelFieldId ?? ""}
            >
              <option value="">Не использовать поле</option>
              {discovery.leadCustomFields.map((field) => (
                <option key={field.id} value={field.id}>{field.name} · {field.id}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="card-actions config-actions">
          <button className="button button-secondary" disabled={pending !== null} onClick={validate} type="button">
            {pending === "validate" ? "Проверяем…" : "Проверить по API"}
          </button>
          <button className="button" disabled={!validation?.valid || pending !== null} onClick={activate} type="button">
            {pending === "activate" ? "Активируем…" : "Активировать новую версию"}
          </button>
        </div>
      </section>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" aria-live="polite">{message}</p> : null}
    </div>
  );
}
