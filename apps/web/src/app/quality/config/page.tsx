import { redirect } from "next/navigation";

import { getActivePipelineConfig, getCurrentSafeAmoConnectionStatus } from "@real2/db";
import { validatePipelineConfig, type PipelineConfigValidation } from "@real2/domain";
import { ulid } from "ulid";

import { AppShell } from "../../../components/app-shell";
import { discoverAmoConfigMetadata } from "../../../lib/amo/config-discovery";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase, getServerEnv } from "../../../lib/server/runtime";

export const dynamic = "force-dynamic";

function validationLabel(value: boolean): string {
  return value ? "совпадает" : "расхождение";
}

export default async function ConfigQualityPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  const config = connection ? await getActivePipelineConfig(db, connection.id) : null;
  let liveValidation: PipelineConfigValidation | null = null;
  if (config) {
    try {
      const discovery = await discoverAmoConfigMetadata(db, getServerEnv(), ulid());
      liveValidation = validatePipelineConfig(
        {
          pipelineId: config.pipelineId,
          applicationStatusId: config.applicationStatusId,
          wonStatusId: config.wonStatusId,
          channelFieldId: config.sourceFieldId,
        },
        discovery,
        {
          activeConfig: {
            pipelineId: config.pipelineId,
            pipelineName: config.pipelineName,
            applicationStatusId: config.applicationStatusId,
            applicationStatusName: config.applicationStatusName,
            wonStatusId: config.wonStatusId,
            wonStatusName: config.wonStatusName,
            channelFieldId: config.sourceFieldId,
            channelFieldName: null,
          },
        },
      );
    } catch {
      // The page remains a safe stored projection when live metadata is unavailable.
    }
  }
  const liveReasons = liveValidation && !liveValidation.valid
    ? liveValidation.reasons
    : [];
  const liveWarnings = liveValidation?.valid ? liveValidation.warnings : [];

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Качество данных</p>
          <h1>Конфигурация amoCRM</h1>
          <p className="muted">Read-only контроль подтверждённых ID, имён и checksum.</p>
        </div>
        {config ? <span className="status-chip">версия {config.version}</span> : null}
      </div>
      {!config ? (
        <section className="panel"><h2>Активной версии нет</h2><p className="muted">Администратор ещё не подтвердил конфигурацию через API.</p></section>
      ) : (
        <div className="settings-grid">
          <section className="panel">
            <h2>{config.pipelineName}</h2>
            <dl className="integration-details">
              <div><dt>Pipeline ID</dt><dd>{config.pipelineId}</dd></div>
              <div><dt>Application status</dt><dd>{config.applicationStatusName} · {config.applicationStatusId}</dd></div>
              <div><dt>Won status</dt><dd>{config.wonStatusName} · {config.wonStatusId}</dd></div>
              <div><dt>Source field ID</dt><dd>{config.sourceFieldId ?? "не выбран"}</dd></div>
            </dl>
          </section>
          <section className="panel">
            <div className="integration-heading">
              <div>
                <h2>Live-проверка</h2>
                <p className="muted">
                  Сравнение активной версии с текущими GET-метаданными amoCRM.
                </p>
              </div>
              <span className={`status-chip${liveValidation?.valid && liveValidation.metadataChecksum === config.metadataChecksum ? "" : " inactive"}`}>
                {!liveValidation
                  ? "недоступно"
                  : liveValidation.valid && liveValidation.metadataChecksum === config.metadataChecksum
                    ? "без изменений"
                    : "обнаружен drift"}
              </span>
            </div>
            <dl className="quality-list">
              <div><dt>Воронка</dt><dd>{liveValidation ? validationLabel(!liveReasons.includes("pipeline_not_confirmed") && !liveWarnings.includes("pipeline_name_changed")) : "не проверено"}</dd></div>
              <div><dt>Этап заявки</dt><dd>{liveValidation ? validationLabel(!liveReasons.includes("application_status_not_confirmed") && !liveWarnings.includes("application_status_name_changed")) : "не проверено"}</dd></div>
              <div><dt>Успешный статус</dt><dd>{liveValidation ? validationLabel(!liveReasons.includes("won_status_not_confirmed") && !liveWarnings.includes("won_status_name_changed")) : "не проверено"}</dd></div>
              <div><dt>Поле источника</dt><dd>{config.sourceFieldId === null ? "не используется" : liveValidation ? validationLabel(!liveReasons.includes("channel_field_not_confirmed")) : "не проверено"}</dd></div>
              <div className="checksum-row"><dt>Checksum</dt><dd><code>{config.metadataChecksum}</code></dd></div>
            </dl>
          </section>
        </div>
      )}
    </AppShell>
  );
}
