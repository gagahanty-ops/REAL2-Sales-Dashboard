import { redirect } from "next/navigation";

import { getDrilldown } from "@real2/db";
import { drilldownMetricSchema } from "@real2/domain";

import { AppShell } from "../../../components/app-shell";
import { AttentionPanel } from "../../../components/dashboard/attention-panel";
import { DataState } from "../../../components/data-state";
import { FreshnessBanner } from "../../../components/dashboard/freshness-banner";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { dashboardHref, filtersToSearchParams } from "../../../lib/dashboard/filter-url";
import {
  loadDashboardPage,
  type SearchParamsInput,
} from "../../../lib/dashboard/page-context";

export const dynamic = "force-dynamic";

const METRIC_TITLE: Readonly<Record<string, string>> = {
  leads_created: "Лиды",
  applications: "Заявки",
  payments: "Оплаты",
  revenue: "Выручка",
  stage_open: "Открытые сделки",
  quality_issue: "Проблемы качества",
};

export default async function DrilldownPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<SearchParamsInput> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  } catch {
    redirect("/");
  }

  const query = (await searchParams) ?? {};
  const requestedMetric = typeof query.metric === "string" ? query.metric : "leads_created";
  const parsedMetric = drilldownMetricSchema.safeParse(requestedMetric);
  const metric = parsedMetric.success ? parsedMetric.data : "leads_created";

  const page = await loadDashboardPage(user, query, (transaction, snapshot, context) =>
    getDrilldown(transaction, snapshot, {
      filters: context.filters,
      scope: context.scope,
      metric,
      limit: 100,
    }));

  const exportHref = `/api/dashboard/export.csv?${filtersToSearchParams(page.filters).toString()}&metric=${metric}`;

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>{METRIC_TITLE[metric] ?? metric}</h1>
          <p>
            Состояние сделок на момент снимка.{" "}
            <a href={dashboardHref("/dashboard", page.filters)}>← К обзору</a>
          </p>
        </div>
        <a href={exportHref}>Скачать CSV</a>
      </div>

      {page.status === "ready" ? (
        <FreshnessBanner
          snapshotVersion={page.snapshot.version}
          generatedAt={page.snapshot.generatedAt}
          sourceFreshAt={page.snapshot.sourceFreshAt}
          stale={false}
        />
      ) : null}

      {!parsedMetric.success ? (
        <p className="stale-notice" role="status">
          Неизвестный показатель заменён на «Лиды».
        </p>
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
        retryHref={dashboardHref("/drilldown", page.filters)}
        emptyMessage="В этом срезе сделок нет."
      >
        {page.status === "ready" ? (
          <AttentionPanel counters={{}} rows={page.data.rows} />
        ) : null}
      </DataState>
    </AppShell>
  );
}
