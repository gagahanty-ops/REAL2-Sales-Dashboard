import { redirect } from "next/navigation";

import {
  getManagerMetrics,
  getOverview,
  withCurrentSnapshot,
  type DashboardOverviewData,
  type ManagerMetrics,
} from "@real2/db";
import {
  AppError,
  deriveDashboardScope,
  parseDashboardFilters,
  toMoscowDate,
  type DashboardFilters,
} from "@real2/domain";

import { AppShell } from "../../../components/app-shell";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { dashboardHref } from "../../../lib/dashboard/filter-url";
import { getDatabase } from "../../../lib/server/runtime";

export const dynamic = "force-dynamic";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function toSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

function formatMoney(value: string): string {
  const [whole, fraction = "00"] = value.split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return `${grouped},${fraction} ₽`;
}

function formatRatio(value: number | null): string {
  return value === null ? "—" : `${value.toString().replace(".", ",")} %`;
}

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toString().replace(".", ",")} %`;
}

export default async function DashboardPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<SearchParams> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  } catch {
    redirect("/");
  }

  const now = new Date();
  const today = toMoscowDate(now.toISOString()) ?? now.toISOString().slice(0, 10);
  let filters: DashboardFilters;
  let invalidFilters = false;
  try {
    filters = parseDashboardFilters(toSearchParams((await searchParams) ?? {}), { today });
  } catch {
    invalidFilters = true;
    filters = parseDashboardFilters(new URLSearchParams(), { today });
  }

  const leadership = user.role === "admin" || user.role === "head";
  let overview: DashboardOverviewData | null = null;
  let managers: ManagerMetrics | null = null;
  let snapshot: Awaited<ReturnType<typeof withCurrentSnapshot>>["snapshot"] | null = null;
  let errorCode: string | null = invalidFilters ? "E_VALIDATION" : null;

  if (!invalidFilters) {
    try {
      const scope = deriveDashboardScope(
        { role: user.role, amoUserId: user.amoUserId },
        filters,
      );
      const result = await withCurrentSnapshot(getDatabase(), async (transaction, meta) => ({
        overview: await getOverview(transaction, meta, { filters, scope, now }),
        managers: await getManagerMetrics(transaction, meta, { filters, scope }),
      }));
      overview = result.data.overview;
      managers = result.data.managers;
      snapshot = result.snapshot;
    } catch (error) {
      errorCode = error instanceof AppError ? error.code : "E_INTERNAL";
    }
  }

  const managerOptions = leadership && managers
    ? managers.rows
        .filter((row) => row.managerKey !== "unassigned")
        .map((row) => ({ value: row.managerKey, label: row.managerName }))
    : [];

  const kind = errorCode !== null
    ? "error"
    : overview === null || overview.totals.leadsCreated === 0
      ? "empty"
      : "content";

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Обзор</h1>
          <p>Все показатели относятся к дате создания сделки по московскому времени.</p>
        </div>
      </div>

      <FilterBar action="/dashboard" filters={filters} managers={managerOptions} />

      {snapshot ? (
        <FreshnessBanner
          snapshotVersion={snapshot.version}
          generatedAt={snapshot.generatedAt}
          sourceFreshAt={snapshot.sourceFreshAt}
          stale={overview?.stale ?? false}
        />
      ) : null}

      <DataState
        kind={kind}
        errorCode={errorCode}
        retryHref={dashboardHref("/dashboard", filters)}
        emptyMessage="За выбранный период сделок не было."
      >
        {overview ? (
          <>
            <section className="kpi-grid">
              {[
                { label: "Лиды", value: String(overview.totals.leadsCreated), delta: overview.deltas?.leadsCreatedPct ?? null },
                { label: "Заявки", value: String(overview.totals.applications), delta: overview.deltas?.applicationsPct ?? null },
                { label: "Оплаты", value: String(overview.totals.payments), delta: overview.deltas?.paymentsPct ?? null },
                { label: "Выручка", value: formatMoney(overview.totals.revenueRub), delta: overview.deltas?.revenuePct ?? null },
              ].map((card) => (
                <article className="kpi-card" key={card.label}>
                  <h2>{card.label}</h2>
                  <p className="kpi-value">{card.value}</p>
                  <p className="kpi-delta">{formatDelta(card.delta)}</p>
                </article>
              ))}
            </section>

            <section>
              <h2>Конверсии</h2>
              <dl className="conversion-list">
                <dt>Лид → заявка</dt>
                <dd>{formatRatio(overview.totals.leadToApplicationPct)}</dd>
                <dt>Заявка → оплата</dt>
                <dd>{formatRatio(overview.totals.applicationToPaymentPct)}</dd>
                <dt>Лид → оплата</dt>
                <dd>{formatRatio(overview.totals.leadToPaymentPct)}</dd>
                <dt>Средний чек</dt>
                <dd>
                  {overview.totals.averageOrderValueRub === null
                    ? "—"
                    : formatMoney(overview.totals.averageOrderValueRub)}
                </dd>
              </dl>
            </section>

            {overview.plans.length > 0 ? (
              <section>
                <h2>План</h2>
                <ul>
                  {overview.plans.map((plan) => (
                    <li key={plan.metricKey}>
                      {plan.metricKey}: {plan.targetValue ?? "—"} (
                      {formatRatio(plan.completionPct)})
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h2>По дням</h2>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Дата</th>
                    <th scope="col">Лиды</th>
                    <th scope="col">Заявки</th>
                    <th scope="col">Оплаты</th>
                    <th scope="col">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.daily.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{point.leadsCreated}</td>
                      <td>{point.applications}</td>
                      <td>{point.payments}</td>
                      <td>{formatMoney(point.revenueRub)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : null}
      </DataState>
    </AppShell>
  );
}
