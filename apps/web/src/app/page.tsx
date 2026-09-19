import { redirect } from "next/navigation";

import {
  getAttention,
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

import { AppShell } from "../components/app-shell";
import { DailyTrend } from "../components/dashboard/daily-trend";
import { KpiGrid } from "../components/dashboard/kpi-grid";
import { PlanProgress } from "../components/dashboard/plan-progress";
import { DataState } from "../components/data-state";
import { FilterBar } from "../components/dashboard/filter-bar";
import { FreshnessBanner } from "../components/dashboard/freshness-banner";
import { requireRole } from "../lib/auth/authorization";
import { requireUser } from "../lib/auth/require-user";
import { dashboardHref, filtersToSearchParams } from "../lib/dashboard/filter-url";
import { qualityLabel } from "../components/dashboard/attention-panel";
import { formatPercent, formatRubles } from "../lib/dashboard/format";
import { getDatabase } from "../lib/server/runtime";

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

export default async function OverviewPage({
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
  let attention: Awaited<ReturnType<typeof getAttention>> | null = null;
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
        attention: await getAttention(transaction, meta, { filters, scope, limit: 5 }),
      }));
      overview = result.data.overview;
      managers = result.data.managers;
      attention = result.data.attention;
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

      <FilterBar action="/" filters={filters} managers={managerOptions} />

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
        retryHref={dashboardHref("/", filters)}
        emptyMessage="За выбранный период сделок не было."
      >
        {overview ? (
          <>
            <KpiGrid
              totals={overview.totals}
              deltas={overview.deltas}
              drilldownHref={(metric) =>
                `/drilldown?${filtersToSearchParams(filters).toString()}&metric=${metric}`}
            />

            <section aria-label="Конверсии">
              <h2>Конверсии</h2>
              <dl className="conversion-list">
                <dt>Лид → заявка</dt>
                <dd>{formatPercent(overview.totals.leadToApplicationPct)}</dd>
                <dt>Заявка → оплата</dt>
                <dd>{formatPercent(overview.totals.applicationToPaymentPct)}</dd>
                <dt>Лид → оплата</dt>
                <dd>{formatPercent(overview.totals.leadToPaymentPct)}</dd>
                <dt>Средний чек</dt>
                <dd>{formatRubles(overview.totals.averageOrderValueRub)}</dd>
              </dl>
            </section>

            <PlanProgress plans={overview.plans} />
            <DailyTrend points={overview.daily} />

            <section aria-label="Требует внимания">
              <h2>Требует внимания</h2>
              {attention && Object.keys(attention.counters).length > 0 ? (
                <>
                  <ul className="quality-counters">
                    {Object.entries(attention.counters)
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([code, count]) => (
                        <li key={code}>
                          {qualityLabel(code)}: {count}
                        </li>
                      ))}
                  </ul>
                  <p>
                    <a href={dashboardHref("/attention", filters)}>
                      Открыть список сделок, требующих внимания
                    </a>
                  </p>
                </>
              ) : (
                <p>В этом срезе проблемных сделок нет.</p>
              )}
            </section>
          </>
        ) : null}
      </DataState>
    </AppShell>
  );
}
