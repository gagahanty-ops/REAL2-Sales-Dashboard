import { redirect } from "next/navigation";

import { listSalesPlans } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";
import { formatMoscowDateTime } from "../../../lib/sync-ui";

export const dynamic = "force-dynamic";

const METRIC_LABEL = {
  leads_created: "Лиды",
  applications: "Заявки",
  payments: "Оплаты",
  revenue: "Выручка",
} as const;

export default async function SalesPlansPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<{ month?: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const requested = (await searchParams)?.month;
  const month = requested && /^\d{4}-\d{2}-01$/.test(requested) ? requested : undefined;
  const plans = await listSalesPlans(getDatabase(), month ? { month } : {});
  const current = plans.filter((plan) => plan.validTo === null);
  const history = plans.filter((plan) => plan.validTo !== null);

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Планы продаж</h1>
          <p>
            План хранится отдельно от amoCRM. Изменение плана журналируется и не
            меняет фактические показатели.
          </p>
        </div>
      </div>

      <section>
        <h2>Действующие цели</h2>
        {current.length === 0 ? (
          <p>Планов пока нет.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Месяц</th>
                <th scope="col">Кому</th>
                <th scope="col">Показатель</th>
                <th scope="col">Цель</th>
                <th scope="col">Версия</th>
              </tr>
            </thead>
            <tbody>
              {current.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.month}</td>
                  <td>{plan.managerKey === "all" ? "Отдел" : plan.managerKey}</td>
                  <td>{METRIC_LABEL[plan.metricKey]}</td>
                  <td>{plan.targetValue}</td>
                  <td>{plan.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>История изменений</h2>
        {history.length === 0 ? (
          <p>История пуста.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Месяц</th>
                <th scope="col">Показатель</th>
                <th scope="col">Цель</th>
                <th scope="col">Версия</th>
                <th scope="col">Закрыт</th>
              </tr>
            </thead>
            <tbody>
              {history.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.month}</td>
                  <td>{METRIC_LABEL[plan.metricKey]}</td>
                  <td>{plan.targetValue}</td>
                  <td>{plan.version}</td>
                  <td>{plan.validTo ? formatMoscowDateTime(plan.validTo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}
