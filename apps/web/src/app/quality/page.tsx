import { redirect } from "next/navigation";

import { listQualityIssues, summarizeOpenQualityIssues } from "@real2/db";
import { QUALITY_CODE_POLICY, evaluateQualityGate, isQualityCode } from "@real2/domain";

import { AppShell } from "../../components/app-shell";
import { qualityLabel } from "../../components/dashboard/attention-panel";
import { QualityAcceptForm } from "../../components/quality-accept-form";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { getDatabase } from "../../lib/server/runtime";
import { formatMoscowDateTime } from "../../lib/sync-ui";

export const dynamic = "force-dynamic";

const SEVERITY_LABEL = {
  info: "Информация",
  warning: "Предупреждение",
  blocking: "Блокирует",
} as const;

const STATUS_LABEL = {
  open: "Открыта",
  resolved: "Закрыта",
  accepted: "Принята",
} as const;

export default async function QualityPage({
  searchParams,
}: Readonly<{ searchParams?: Promise<{ code?: string; cursor?: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const params = await searchParams;
  const code = params?.code && isQualityCode(params.code) ? params.code : undefined;
  const db = getDatabase();
  const [page, summary] = await Promise.all([
    listQualityIssues(db, { code, cursor: params?.cursor ?? null, status: "open" }),
    summarizeOpenQualityIssues(db),
  ]);
  const gate = evaluateQualityGate(summary);
  const openCodes = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Качество данных</h1>
          <p>
            {gate.approved
              ? "Публикация production-снимка разрешена."
              : `Публикация заблокирована: ${gate.blockingCodes.join(", ")}`}
          </p>
        </div>
      </div>

      <section>
        <h2>Открытые проблемы по кодам</h2>
        {openCodes.length === 0 ? (
          <p>Открытых проблем нет.</p>
        ) : (
          <ul className="quality-counters">
            {openCodes.map(([counter, count]) => (
              <li key={counter}>
                {qualityLabel(counter.replace(/_count$/u, ""))}: {count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Список</h2>
        {page.items.length === 0 ? (
          <p>Ничего не найдено.</p>
        ) : (
          <div className="table-scroll">
          <table className="metric-table">
            <caption>Проблемы качества данных</caption>
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Важность</th>
                <th scope="col">Статус</th>
                <th scope="col">Сделка</th>
                <th scope="col">Последнее наблюдение</th>
                <th scope="col">Решение</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((issue) => (
                <tr key={issue.id}>
                  <th scope="row">{qualityLabel(issue.code)}</th>
                  <td>{SEVERITY_LABEL[issue.severity]}</td>
                  <td>{STATUS_LABEL[issue.status]}</td>
                  <td>{issue.amoLeadId ?? "—"}</td>
                  <td>{formatMoscowDateTime(issue.lastSeenAt)}</td>
                  <td>
                    {user.role === "admin" && issue.status === "open" ? (
                      <QualityAcceptForm
                        acceptable={
                          isQualityCode(issue.code)
                          && QUALITY_CODE_POLICY[issue.code].acceptable
                        }
                        issueId={issue.id}
                      />
                    ) : isQualityCode(issue.code)
                      && QUALITY_CODE_POLICY[issue.code].acceptable
                      ? "можно принять"
                      : "принять нельзя"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {page.nextCursor ? (
          <a href={`/quality?cursor=${encodeURIComponent(page.nextCursor)}`}>
            Следующая страница
          </a>
        ) : null}
      </section>
    </AppShell>
  );
}
