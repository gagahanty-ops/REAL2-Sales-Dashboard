import { redirect } from "next/navigation";

import { getChannelMetrics } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { DataState } from "../../../components/data-state";
import { FilterBar } from "../../../components/dashboard/filter-bar";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { MetricTable } from "../../../components/dashboard/metric-table";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { CHANNEL_OPTIONS, dashboardHref, filtersToSearchParams } from "../../../lib/dashboard/filter-url";
import { SORTABLE_COLUMNS, parseSort, sortHref, sortRows } from "../../../lib/dashboard/table-sort";
import { formatPercent } from "../../../lib/dashboard/format";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

const EMPTY_TOTALS = {
  leadsCreated: 0,
  applications: 0,
  payments: 0,
  revenueRub: "0.00",
  leadToApplicationPct: null,
  applicationToPaymentPct: null,
  leadToPaymentPct: null,
  averageOrderValueRub: null,
} as const;

/**
 * METRICS_CATALOG §7: the `unknown` group stays visible even when it is empty
 * in the current filter, so a channel problem cannot hide behind a zero.
 */
function withUnknownGroup<T extends Readonly<{ channel: string; totals: unknown }>>(
  rows: readonly T[],
): readonly T[] {
  if (rows.some((row) => row.channel === "unknown")) return rows;
  return [...rows, { channel: "unknown", totals: EMPTY_TOTALS } as unknown as T];
}

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

  const query = (await searchParams) ?? {};
  const sort = parseSort(
    typeof query.sort === "string" ? query.sort : undefined,
    typeof query.dir === "string" ? query.dir : undefined,
  );
  const page = await loadDashboardPage(user, query,
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
            sortLinks={Object.fromEntries(
              SORTABLE_COLUMNS.map((column) => [
                column,
                {
                  column,
                  href: sortHref("/channels", filtersToSearchParams(page.filters), column, sort),
                  active: sort.column === column,
                },
              ]),
            )}
            extraColumn={{
              title: "Доля оплат",
              render: (row) =>
                formatPercent(
                  page.data.totals.payments === 0
                    ? null
                    : Math.round((row.totals.payments / page.data.totals.payments) * 1_000) / 10,
                ),
            }}
            rows={sortRows(withUnknownGroup(page.data.rows), sort).map((row) => ({
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
