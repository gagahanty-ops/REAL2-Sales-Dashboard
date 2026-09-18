import { redirect } from "next/navigation";

import { getChannelMetrics } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { MetricTable } from "../../../components/dashboard/metric-table";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { CHANNEL_OPTIONS, dashboardHref } from "../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

function channelLabel(channel: string): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel;
}

export default async function ChannelsPage({
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
      getChannelMetrics(transaction, snapshot, {
        filters: context.filters,
        scope: context.scope,
      }));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Каналы</h1>
          <p>Канал определяется подтверждённым правилом; неизвестные значения видны отдельно.</p>
        </div>
      </div>

      <FilterBar
        action="/channels"
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
        retryHref={dashboardHref("/channels", page.filters)}
        emptyMessage="За выбранный период сделок по каналам не было."
      >
        {page.status === "ready" ? (
          <MetricTable
            caption="Показатели по каналам за выбранный период"
            firstColumn="Канал"
            rows={page.data.rows.map((row) => ({
              key: row.channel,
              label: channelLabel(row.channel),
              totals: row.totals,
            }))}
            totals={page.data.totals}
          />
        ) : null}
      </DataState>
    </AppShell>
  );
}
