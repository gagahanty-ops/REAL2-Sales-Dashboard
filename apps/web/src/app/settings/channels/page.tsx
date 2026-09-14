import { redirect } from "next/navigation";

import { getActivePipelineConfig, getCurrentSafeAmoConnectionStatus } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { ChannelRulesManager } from "../../../components/channel-rules-manager";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";

export const dynamic = "force-dynamic";

export default async function ChannelSettingsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const connection = await getCurrentSafeAmoConnectionStatus(db);
  const config = connection ? await getActivePipelineConfig(db, connection.id) : null;

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Каналы</h1>
          <p className="muted">
            Только точные соответствия. Неподтверждённые и конфликтующие значения остаются unknown.
          </p>
        </div>
        {config ? <span className="status-chip">версия {config.version}</span> : null}
      </div>
      {!config ? (
        <section className="panel">
          <h2>Активные правила</h2>
          <p className="muted">Сначала активируйте конфигурацию воронки.</p>
        </section>
      ) : (
        <ChannelRulesManager
          initialConfig={{
            configId: config.id,
            version: config.version,
            candidate: {
              pipelineId: config.pipelineId,
              applicationStatusId: config.applicationStatusId,
              wonStatusId: config.wonStatusId,
              channelFieldId: config.sourceFieldId,
            },
            channelRules: config.channelRules.map((rule) => ({
              priority: rule.priority,
              matchType: rule.matchType,
              matchValue: rule.matchValue,
              normalizedChannel: rule.normalizedChannel,
            })),
          }}
        />
      )}
      <section className="panel">
        <h2>Встреченные значения</h2>
        <p className="muted">
          После первой теневой синхронизации здесь появятся raw-значение,
          количество сделок и состояние mapped, unknown или conflict. Пока
          значения не обнаружены; свободный текст не угадывается.
        </p>
      </section>
    </AppShell>
  );
}
