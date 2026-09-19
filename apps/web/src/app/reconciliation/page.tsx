import { redirect } from "next/navigation";

import { getCurrentSnapshot, withCurrentSnapshot } from "@real2/db";
import { MANUAL_REPORT_HEADERS } from "@real2/domain";

import { AppShell } from "../../components/app-shell";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { formatDate, formatRubles } from "../../lib/dashboard/format";
import { getDatabase } from "../../lib/server/runtime";

export const dynamic = "force-dynamic";

type SnapshotRow = {
  report_date: Date;
  manager_name: string;
  leads_created: number;
  applications: number;
  payments: number;
  revenue: string;
};

export default async function ReconciliationPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<{ from?: string; to?: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const params = (await searchParams) ?? {};
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const from = params.from && pattern.test(params.from) ? params.from : null;
  const to = params.to && pattern.test(params.to) ? params.to : null;

  const db = getDatabase();
  const snapshot = await getCurrentSnapshot(db);
  let rows: readonly SnapshotRow[] = [];
  if (snapshot && from && to) {
    const result = await withCurrentSnapshot(db, async (transaction, meta) =>
      transaction<SnapshotRow[]>`
        select
          facts.report_date,
          facts.manager_name,
          count(*)::integer as leads_created,
          count(*) filter (where facts.application_at is not null)::integer as applications,
          count(*) filter (
            where facts.currently_won and facts.won_at is not null
          )::integer as payments,
          coalesce(
            sum(facts.price_rub) filter (
              where facts.currently_won and facts.won_at is not null
            ),
            0
          )::text as revenue
        from public.metric_lead_facts as facts
        where facts.snapshot_id = ${meta.id}
          and facts.report_date >= ${from}
          and facts.report_date <= ${to}
        group by facts.report_date, facts.manager_name
        order by facts.report_date, facts.manager_name
      `);
    rows = result.data;
  }

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Теневая сверка</h1>
          <p>
            Сравнение ведётся с выгрузкой из ручного отчёта. Система не читает
            исходную таблицу и ничего в неё не пишет.
          </p>
        </div>
      </div>

      <section>
        <h2>Как сверять</h2>
        <ol>
          <li>Выгрузите ручной отчёт в CSV с колонками: {MANUAL_REPORT_HEADERS.join("; ")}.</li>
          <li>Откройте эту страницу с диапазоном: <code>?from=2026-09-01&amp;to=2026-09-07</code>.</li>
          <li>
            Сверьте строки: расхождение даже в одну сделку или одну копейку
            означает, что день не принят.
          </li>
          <li>
            Запишите результат дня в <code>docs/runbooks/release-evidence/</code>.
          </li>
        </ol>
      </section>

      <section>
        <h2>
          Снимок {snapshot ? `№${snapshot.version}` : "отсутствует"}
          {from && to ? `, период ${formatDate(from)} — ${formatDate(to)}` : ""}
        </h2>
        {!snapshot ? (
          <p>Утверждённого снимка нет: сверять пока нечего.</p>
        ) : !from || !to ? (
          <p>Укажите период в адресе страницы.</p>
        ) : rows.length === 0 ? (
          <p>За выбранный период в снимке нет сделок.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Строки снимка в том же виде, что и ручной отчёт</caption>
              <thead>
                <tr>
                  {MANUAL_REPORT_HEADERS.map((header) => (
                    <th key={header} scope="col">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.report_date.toISOString()}-${row.manager_name}`}>
                    <th scope="row">
                      {formatDate(row.report_date.toISOString().slice(0, 10))}
                    </th>
                    <td>{row.manager_name}</td>
                    <td>{row.leads_created}</td>
                    <td>{row.applications}</td>
                    <td>{row.payments}</td>
                    <td>{formatRubles(row.revenue.includes(".") ? row.revenue : `${row.revenue}.00`)}</td>
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
