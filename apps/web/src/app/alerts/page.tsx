import { redirect } from "next/navigation";

import { listAlerts } from "@real2/db";

import { AlertAcknowledgeButton } from "../../components/alert-acknowledge-button";
import { AppShell } from "../../components/app-shell";
import { alertCodeLabel, alertSourceLabel } from "../../lib/alerts/labels";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { getDatabase } from "../../lib/server/runtime";
import { formatMoscowDateTimeCompact } from "../../lib/sync-ui";

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

const STATUS_FILTERS = [
  { label: "Все", href: "/alerts", status: undefined },
  { label: "Открытые", href: "/alerts?status=open", status: "open" },
  {
    label: "Принятые к сведению",
    href: "/alerts?status=acknowledged",
    status: "acknowledged",
  },
  { label: "Закрытые", href: "/alerts?status=resolved", status: "resolved" },
] as const;

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
          <p className="eyebrow">Дежурство</p>
          <h1>Оповещения</h1>
          <p className="muted">
            Одно оповещение на источник и код: повтор увеличивает счётчик, а не
            плодит строки. Отметка «я увидел» фиксирует, кто посмотрел, и не
            закрывает причину.
          </p>
        </div>
      </div>

      <nav className="filter-links" aria-label="Фильтр оповещений">
        {STATUS_FILTERS.map((filter) => (
          <a
            key={filter.label}
            href={filter.href}
            aria-current={filter.status === status ? "page" : undefined}
          >
            {filter.label}
          </a>
        ))}
      </nav>

      <section>
        <h2>Список</h2>
        {alerts.length === 0 ? (
          <p className="muted">Оповещений нет.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Оповещения системы</caption>
              <thead>
                <tr>
                  <th scope="col">Что случилось</th>
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
                    <th className="wrap-cell" scope="row">
                      {alertCodeLabel(alert.code)}
                      <span className="cell-note">{alertSourceLabel(alert.source)}</span>
                    </th>
                    <td>{SEVERITY_LABEL[alert.severity]}</td>
                    <td>{STATUS_LABEL[alert.status]}</td>
                    <td className="wrap-cell">{alert.safeSummary}</td>
                    <td>{alert.occurrenceCount}</td>
                    <td>{formatMoscowDateTimeCompact(alert.lastSeenAt)}</td>
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
