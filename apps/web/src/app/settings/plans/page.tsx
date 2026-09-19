import { redirect } from "next/navigation";

import { listSalesPlans, withCurrentSnapshot, getManagerMetrics } from "@real2/db";
import { parseDashboardFilters, toMoscowDate } from "@real2/domain";

import { AppShell } from "../../../components/app-shell";
import { PlanTargetForm } from "../../../components/plan-target-form";
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
  const db = getDatabase();
  const plans = await listSalesPlans(db, month ? { month } : {});

  // Manager names come from the current snapshot so a target is set for a
  // person the report actually knows.
  let managers: readonly Readonly<{ value: string; label: string }>[] = [];
  if (user.role === "admin") {
    try {
      const now = new Date();
      const today = toMoscowDate(now.toISOString()) ?? now.toISOString().slice(0, 10);
      const filters = parseDashboardFilters(new URLSearchParams(), { today });
      const result = await withCurrentSnapshot(db, (transaction, snapshot) =>
        getManagerMetrics(transaction, snapshot, {
          filters,
          scope: { kind: "department", amoUserIds: [], includeUnassigned: false },
        }));
      managers = result.data.rows
        .filter((row) => row.managerKey !== "unassigned")
        .map((row) => ({ value: row.managerKey, label: row.managerName }));
    } catch {
      managers = [];
    }
  }
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

      {user.role === "admin" ? (
        <section aria-label="Новая цель">
          <h2>Задать цель</h2>
          <PlanTargetForm managers={managers} />
        </section>
      ) : null}

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
