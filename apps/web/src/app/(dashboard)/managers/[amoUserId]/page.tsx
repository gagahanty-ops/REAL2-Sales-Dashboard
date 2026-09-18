import { notFound, redirect } from "next/navigation";

import { getManagerMetrics, getOverview } from "@real2/db";

import { AppShell } from "../../../../components/app-shell";
import { DailyTrend } from "../../../../components/dashboard/daily-trend";
import { DataState } from "../../../../components/data-state";
import { FreshnessBanner } from "../../../../components/dashboard/freshness-banner";
import { KpiGrid } from "../../../../components/dashboard/kpi-grid";
import { PlanProgress } from "../../../../components/dashboard/plan-progress";
import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { dashboardHref } from "../../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

export default async function ManagerDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ amoUserId: string }>;
  searchParams?: Promise<SearchParamsInput>;
}>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  } catch {
    redirect("/");
  }

  const { amoUserId } = await params;
  if (!/^[1-9]\d{0,14}$/.test(amoUserId)) notFound();

  // The manager filter of the URL is replaced by the manager of the path; scope
  // derivation still refuses a manager who asks for somebody else.
  const query = { ...((await searchParams) ?? {}), manager: `amo:${amoUserId}` };
  const page = await loadDashboardPage(user, query, async (transaction, snapshot, context) => ({
    overview: await getOverview(transaction, snapshot, {
      filters: context.filters,
      scope: context.scope,
      now: new Date(),
    }),
    managers: await getManagerMetrics(transaction, snapshot, {
      filters: context.filters,
      scope: context.scope,
    }),
  }));

  const managerName = page.status === "ready"
    ? page.data.managers.rows[0]?.managerName ?? `Менеджер ${amoUserId}`
    : `Менеджер ${amoUserId}`;

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>{managerName}</h1>
          <p>
            <a href={dashboardHref("/managers", page.filters)}>← Ко всем менеджерам</a>
          </p>
        </div>
      </div>

      {page.status === "ready" ? (
        <FreshnessBanner
          snapshotVersion={page.snapshot.version}
          generatedAt={page.snapshot.generatedAt}
          sourceFreshAt={page.snapshot.sourceFreshAt}
          stale={page.data.overview.stale}
        />
      ) : null}

      <DataState
        kind={
          page.status === "error"
            ? "error"
            : page.data.overview.totals.leadsCreated === 0
              ? "empty"
              : "content"
        }
        errorCode={page.status === "error" ? page.errorCode : null}
        retryHref={dashboardHref(`/managers/${amoUserId}`, page.filters)}
        emptyMessage="За выбранный период у менеджера не было сделок."
      >
        {page.status === "ready" ? (
          <>
            <KpiGrid
              totals={page.data.overview.totals}
              deltas={page.data.overview.deltas}
            />
            <PlanProgress plans={page.data.overview.plans} />
            <DailyTrend points={page.data.overview.daily} />
          </>
        ) : null}
      </DataState>
    </AppShell>
  );
}
