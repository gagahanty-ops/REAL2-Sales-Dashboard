import { redirect } from "next/navigation";

import { listAlerts } from "@real2/db";

import { AlertAcknowledgeButton } from "../../components/alert-acknowledge-button";
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

const STATUS_LABEL = {
  open: "Открыто",
  acknowledged: "Принято к сведению",
  resolved: "Закрыто",
} as const;

export default async function AlertsPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<{ status?: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const requested = (await searchParams)?.status;
  const status = requested === "open" || requested === "acknowledged" || requested === "resolved"
    ? requested
    : undefined;
  const alerts = await listAlerts(getDatabase(), status ? { status } : {});

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Оповещения</h1>
          <p>
            Одно оповещение на источник и код: повтор увеличивает счётчик, а не
            плодит строки. Отметка «я увидел» фиксирует, кто посмотрел, и не
            закрывает причину.
          </p>
        </div>
      </div>

      <nav aria-label="Фильтр оповещений">
        <a href="/alerts">Все</a> · <a href="/alerts?status=open">Открытые</a> ·{" "}
        <a href="/alerts?status=acknowledged">Принятые к сведению</a> ·{" "}
        <a href="/alerts?status=resolved">Закрытые</a>
      </nav>

      <section>
        <h2>Список</h2>
        {alerts.length === 0 ? (
          <p>Оповещений нет.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Оповещения системы</caption>
              <thead>
                <tr>
                  <th scope="col">Код</th>
                  <th scope="col">Источник</th>
                  <th scope="col">Важность</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Что произошло</th>
                  <th scope="col">Повторов</th>
                  <th scope="col">Последний раз</th>
                  <th scope="col">Действие</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <th scope="row">{alert.code}</th>
                    <td>{alert.source}</td>
                    <td>{SEVERITY_LABEL[alert.severity]}</td>
                    <td>{STATUS_LABEL[alert.status]}</td>
                    <td>{alert.safeSummary}</td>
                    <td>{alert.occurrenceCount}</td>
                    <td>{formatMoscowDateTime(alert.lastSeenAt)}</td>
                    <td>
                      <AlertAcknowledgeButton
                        alertId={alert.id}
                        disabled={user.role !== "admin" || alert.status !== "open"}
                      />
                    </td>
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
