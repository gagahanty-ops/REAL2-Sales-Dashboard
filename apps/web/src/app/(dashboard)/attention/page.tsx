import { redirect } from "next/navigation";

import { getAttention } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { AttentionPanel } from "../../../components/dashboard/attention-panel";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { dashboardHref } from "../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

export default async function AttentionPage({
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
      getAttention(transaction, snapshot, {
        filters: context.filters,
        scope: context.scope,
      }));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Требует внимания</h1>
          <p>Сделки с открытыми проблемами качества в выбранном срезе.</p>
        </div>
      </div>

      <FilterBar
        action="/attention"
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
        kind={page.status === "error" ? "error" : "content"}
        errorCode={page.status === "error" ? page.errorCode : null}
        retryHref={dashboardHref("/attention", page.filters)}
      >
        {page.status === "ready" ? (
          <AttentionPanel counters={page.data.counters} grouped rows={page.data.rows} />
        ) : null}
      </DataState>
    </AppShell>
  );
}
