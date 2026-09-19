import { redirect } from "next/navigation";

import {
  collectSystemStatus,
  isDatabaseReachable,
  listAlerts,
} from "@real2/db";
import { evaluateSystemHealth } from "@real2/domain";

import { AppShell } from "../../components/app-shell";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { getDatabase } from "../../lib/server/runtime";
import { formatMoscowDateTime } from "../../lib/sync-ui";

export const dynamic = "force-dynamic";

const SEVERITY_LABEL = {
  info: "Информация",
  warning: "Предупреждение",
  critical: "Критично",
} as const;

export default async function SystemPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const databaseReachable = await isDatabaseReachable(db);
  const status = await collectSystemStatus(db);
  const health = evaluateSystemHealth({ ...status, now: new Date(), databaseReachable });
  const alerts = await listAlerts(db, { status: "open", limit: 50 });

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Состояние системы</h1>
          <p>
            Отчёт продолжает показывать последний утверждённый снимок, даже когда
            источник недоступен: устаревшее число с честной отметкой времени
            полезнее пустого экрана.
          </p>
        </div>
      </div>

      <section>
        <h2>Готовность</h2>
        <ul>
          <li>База данных: {health.readiness.checks.database ? "доступна" : "недоступна"}</li>
          <li>
            Конфигурация воронки:{" "}
            {health.readiness.checks.activeConfig ? "выбрана" : "не выбрана"}
          </li>
          <li>
            Текущий снимок:{" "}
            {health.readiness.checks.currentSnapshot
              ? `№${health.dashboard.snapshotVersion}`
              : "отсутствует"}
          </li>
          <li>
            Свежесть источника:{" "}
            {status.lastSuccessfulSyncAt
              ? formatMoscowDateTime(status.lastSuccessfulSyncAt)
              : "синхронизаций не было"}
            {health.dashboard.stale ? " (отстаёт)" : ""}
          </li>
        </ul>
      </section>

      <section>
        <h2>Открытые оповещения</h2>
        {alerts.length === 0 ? (
          <p>Открытых оповещений нет.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Оповещения, ожидающие решения</caption>
              <thead>
                <tr>
                  <th scope="col">Код</th>
                  <th scope="col">Важность</th>
                  <th scope="col">Что произошло</th>
                  <th scope="col">Повторов</th>
                  <th scope="col">Последний раз</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <th scope="row">{alert.code}</th>
                    <td>{SEVERITY_LABEL[alert.severity]}</td>
                    <td>{alert.safeSummary}</td>
                    <td>{alert.occurrenceCount}</td>
                    <td>{formatMoscowDateTime(alert.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
