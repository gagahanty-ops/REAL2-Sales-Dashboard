import { redirect } from "next/navigation";

import { getActivePipelineConfig, getCurrentSafeAmoConnectionStatus } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";

export const dynamic = "force-dynamic";

const channelLabels: Record<string, string> = {
  phone_uis: "Телефон / UIS",
  whatsapp: "WhatsApp",
  avito: "Avito",
  instagram: "Instagram",
  site: "Сайт",
  telegram: "Telegram",
  max: "MAX",
  unknown: "Неизвестно",
};

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
      <section className="panel">
        <h2>Активные правила</h2>
        {!config ? (
          <p className="muted">Сначала активируйте конфигурацию воронки.</p>
        ) : (
          <div className="config-table-wrap">
            <table className="config-table">
              <thead>
                <tr><th>Приоритет</th><th>Источник</th><th>Точное значение</th><th>Канал</th><th>Состояние</th></tr>
              </thead>
              <tbody>
                {config.channelRules.map((rule) => (
                  <tr key={`${rule.matchType}:${rule.matchValue}`}>
                    <td>{rule.priority}</td>
                    <td>{rule.matchType}</td>
                    <td>{rule.matchValue}</td>
                    <td>{channelLabels[rule.normalizedChannel] ?? rule.normalizedChannel}</td>
                    <td><span className={`status-chip${rule.isActive ? "" : " inactive"}`}>{rule.isActive ? "mapped" : "inactive"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
