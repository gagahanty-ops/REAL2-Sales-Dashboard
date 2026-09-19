import { redirect } from "next/navigation";

import { listSalesPlans } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { PlanTargetForm } from "../../../components/plan-target-form";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { listManagedUsers } from "../../../lib/auth/user-admin";
import { formatCount, formatMonth, formatRubles } from "../../../lib/dashboard/format";
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

  // A target is set for a person, not for whoever happened to have leads in
  // the default reporting window, so the list comes from the access registry.
  const staff = user.role === "admin" ? await listManagedUsers(db) : [];
  const managers: readonly Readonly<{ value: string; label: string }>[] = staff
    .filter((member) => member.isActive && member.amoUserId !== null)
    .map((member) => ({
      value: `amo:${member.amoUserId}`,
      label: member.fullName,
    }));

  const managerName = (key: string): string =>
    key === "all"
      ? "Отдел целиком"
      : managers.find((manager) => manager.value === key)?.label ?? key;
  const formatTarget = (plan: Readonly<{ metricKey: string; targetValue: string }>): string =>
    plan.metricKey === "revenue"
      ? formatRubles(plan.targetValue)
      : formatCount(Number(plan.targetValue));

  const current = plans.filter((plan) => plan.validTo === null);
  const history = plans.filter((plan) => plan.validTo !== null);

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Планы продаж</h1>
          <p className="muted">
            План хранится отдельно от amoCRM. Изменение плана журналируется и не
            меняет фактические показатели.
          </p>
        </div>
      </div>

      {user.role === "admin" ? (
        <section className="panel" aria-label="Новая цель">
          <h2>Задать цель</h2>
          <PlanTargetForm managers={managers} />
        </section>
      ) : null}

      <section>
        <h2>Действующие цели</h2>
        {current.length === 0 ? (
          <p className="muted">Планов пока нет.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Цели, действующие сейчас</caption>
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
                    <th scope="row">{formatMonth(plan.month)}</th>
                    <td>{managerName(plan.managerKey)}</td>
                    <td>{METRIC_LABEL[plan.metricKey]}</td>
                    <td>{formatTarget(plan)}</td>
                    <td>{plan.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>История изменений</h2>
        {history.length === 0 ? (
          <p className="muted">История пуста.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Закрытые версии целей</caption>
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
                    <th scope="row">{formatMonth(plan.month)}</th>
                    <td>{METRIC_LABEL[plan.metricKey]}</td>
                    <td>{formatTarget(plan)}</td>
                    <td>{plan.version}</td>
                    <td>{plan.validTo ? formatMoscowDateTime(plan.validTo) : "—"}</td>
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
