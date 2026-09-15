import Link from "next/link";
import { redirect } from "next/navigation";

import { getLatestSyncRun, listSyncRuns } from "@real2/db";

import { AppShell } from "../../components/app-shell";
import { SyncTrigger } from "../../components/sync-trigger";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { getDatabase } from "../../lib/server/runtime";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  if (!value) return "выполняется";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function duration(startedAt: Date, finishedAt: Date | null): string {
  if (!finishedAt) return "выполняется";
  return `${Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1_000))} с`;
}

export default async function SyncRunsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const [latest, history] = await Promise.all([
    getLatestSyncRun(db),
    listSyncRuns(db, { page: 1, pageSize: 25 }),
  ]);
  const recentRun = latest
    ? Date.now() - latest.startedAt.getTime() < 60_000
    : false;

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Контроль синхронизации</p>
          <h1>Запуски amoCRM</h1>
          <p className="muted">Показываются только безопасные статусы, счётчики и агрегированный audit.</p>
        </div>
        {user.role === "admin" ? <SyncTrigger recentRun={recentRun} /> : null}
      </div>
      <section className="panel sync-summary">
        <h2>Свежесть</h2>
        {latest ? (
          <dl className="integration-details">
            <div><dt>Последний запуск</dt><dd>{formatDate(latest.startedAt)}</dd></div>
            <div><dt>Статус</dt><dd>{latest.status}</dd></div>
            <div><dt>Тип</dt><dd>{latest.kind}</dd></div>
            <div><dt>Длительность</dt><dd>{duration(latest.startedAt, latest.finishedAt)}</dd></div>
          </dl>
        ) : <p className="muted">Запусков ещё не было.</p>}
      </section>
      <section className="panel sync-history">
        <h2>История</h2>
        <div className="config-table-wrap">
          <table className="config-table">
            <thead><tr><th>Начало</th><th>Тип</th><th>Статус</th><th>Страницы</th><th>Лиды</th><th>События</th><th>Retries</th></tr></thead>
            <tbody>
              {history.items.map((run) => (
                <tr key={run.id}>
                  <td><Link href={`/sync/${run.id}`}>{formatDate(run.startedAt)}</Link></td>
                  <td>{run.kind}</td><td>{run.status}</td><td>{run.counts.pages}</td>
                  <td>{run.counts.leads}</td><td>{run.counts.events}</td><td>{run.counts.retries}</td>
                </tr>
              ))}
              {history.items.length === 0 ? <tr><td colSpan={7} className="muted">Нет безопасной истории запусков.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
