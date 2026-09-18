import { redirect } from "next/navigation";

import { getManagerMetrics } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { MetricTable } from "../../../components/dashboard/metric-table";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { dashboardHref, filtersToSearchParams } from "../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

export default async function ManagersPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<SearchParamsInput> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  } catch {
    redirect("/");
  }

  const page = await loadDashboardPage(user, (await searchParams) ?? {},
    (transaction, snapshot, context) =>
      getManagerMetrics(transaction, snapshot, {
        filters: context.filters,
        scope: context.scope,
      }));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Менеджеры</h1>
          <p>Портфель считается по текущему ответственному из последнего снимка.</p>
        </div>
      </div>

      <FilterBar
        action="/managers"
        filters={page.filters}
        managers={page.status === "ready" ? page.managerOptions : []}
      />

      {page.status === "ready" ? (
        <FreshnessBanner
          snapshotVersion={page.snapshot.version}
          generatedAt={page.snapshot.generatedAt}
          sourceFreshAt={page.snapshot.sourceFreshAt}
          stale={false}
        />
      ) : null}

      <DataState
        kind={
          page.status === "error"
            ? "error"
            : page.data.rows.length === 0
              ? "empty"
              : "content"
        }
        errorCode={page.status === "error" ? page.errorCode : null}
        retryHref={dashboardHref("/managers", page.filters)}
        emptyMessage="За выбранный период сделок у менеджеров не было."
      >
        {page.status === "ready" ? (
          <MetricTable
            caption="Показатели по менеджерам за выбранный период"
            firstColumn="Менеджер"
            rows={page.data.rows.map((row) => ({
              key: row.managerKey,
              label: row.managerName,
              href: row.managerKey === "unassigned"
                ? undefined
                : `/managers/${row.managerKey}?${filtersToSearchParams(page.filters).toString()}`,
              totals: row.totals,
            }))}
            totals={page.data.totals}
          />
        ) : null}
      </DataState>
    </AppShell>
  );
}
