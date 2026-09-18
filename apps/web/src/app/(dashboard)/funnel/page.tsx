import { redirect } from "next/navigation";

import { getFunnelMetrics } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { FunnelView } from "../../../components/dashboard/funnel-view";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { dashboardHref } from "../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

export default async function FunnelPage({
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
      getFunnelMetrics(transaction, snapshot, { scope: context.scope, filters: context.filters }));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Воронка</h1>
          <p>Открытые сделки по этапам и время, проведённое на текущем этапе.</p>
        </div>
      </div>

      <FilterBar
        action="/funnel"
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
            : page.data.stages.length === 0
              ? "empty"
              : "content"
        }
        errorCode={page.status === "error" ? page.errorCode : null}
        retryHref={dashboardHref("/funnel", page.filters)}
        emptyMessage="Открытых сделок в этом срезе нет."
      >
        {page.status === "ready" ? <FunnelView stages={page.data.stages} /> : null}
      </DataState>
    </AppShell>
  );
}
