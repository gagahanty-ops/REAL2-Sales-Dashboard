import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { getSyncRunDetail } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";
import { formatCreatedBy, formatMoscowDateTime } from "../../../lib/sync-ui";

export const dynamic = "force-dynamic";

export default async function SyncRunDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const run = await getSyncRunDetail(getDatabase(), parsed.data);
  if (!run) notFound();

  return (
    <AppShell user={user}>
      <div className="page-heading"><div><p className="eyebrow">Синхронизация</p><h1>{run.kind}</h1><p className="muted">Trace ID: {run.traceId}</p></div><Link href="/sync">К истории</Link></div>
      <section className="panel"><h2>{run.status}</h2><dl className="integration-details"><div><dt>Начало</dt><dd>{formatMoscowDateTime(run.startedAt)}</dd></div><div><dt>Завершение</dt><dd>{formatMoscowDateTime(run.finishedAt)}</dd></div><div><dt>Кем запущено</dt><dd>{formatCreatedBy(run.createdBy)}</dd></div><div><dt>Страницы</dt><dd>{run.counts.pages}</dd></div><div><dt>Повторы</dt><dd>{run.counts.retries}</dd></div></dl>{run.errorSummary ? <p className="form-error">{run.errorSummary}</p> : null}</section>
      <section className="panel sync-history"><h2>Этапы</h2><div className="config-table-wrap"><table className="config-table"><thead><tr><th>Поток</th><th>Страница</th><th>Объектов</th><th>Получено</th></tr></thead><tbody>{run.pages.map((page) => <tr key={`${page.stream}-${page.pageNumber}`}><td>{page.stream}</td><td>{page.pageNumber}</td><td>{page.itemCount}</td><td>{formatMoscowDateTime(page.receivedAt)}</td></tr>)}{run.pages.length === 0 ? <tr><td colSpan={4} className="muted">Страницы ещё не записаны.</td></tr> : null}</tbody></table></div></section>
      <section className="panel sync-history"><h2>HTTP audit</h2><div className="config-table-wrap"><table className="config-table"><thead><tr><th>Метод</th><th>Путь</th><th>Статус</th><th>Запросы</th><th>Время, мс</th><th>Макс. попытка</th></tr></thead><tbody>{run.audit.map((audit) => <tr key={`${audit.method}-${audit.normalizedPath}-${audit.responseStatus}-${audit.result}`}><td>{audit.method}</td><td>{audit.normalizedPath}</td><td>{audit.responseStatus ?? "—"}</td><td>{audit.requestCount}</td><td>{audit.totalDurationMs}</td><td>{audit.maxAttempt}</td></tr>)}{run.audit.length === 0 ? <tr><td colSpan={6} className="muted">Безопасных audit-записей нет.</td></tr> : null}</tbody></table></div></section>
    </AppShell>
  );
}
