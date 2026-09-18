import { notFound, redirect } from "next/navigation";

import {
  getCurrentSnapshot,
  getSnapshotByVersion,
  listSnapshotCells,
  validateSnapshot,
} from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";
import { formatMoscowDateTime } from "../../../lib/sync-ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  candidate: "Кандидат",
  approved: "Утверждён",
  published: "Опубликован",
  rejected: "Отклонён",
} as const;

export default async function SnapshotPage({
  params,
}: Readonly<{ params: Promise<{ version: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const { version } = await params;
  const db = getDatabase();
  const snapshot = version === "current"
    ? await getCurrentSnapshot(db)
    : /^[1-9]\d{0,14}$/.test(version)
      ? await getSnapshotByVersion(db, Number(version))
      : null;
  if (!snapshot) notFound();

  const [totals, validation] = await Promise.all([
    listSnapshotCells(db, snapshot.id),
    validateSnapshot(db, snapshot.id),
  ]);
  const openIssues = Object.entries(snapshot.qualitySummary)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Снимок №{snapshot.version}</h1>
          <p>
            {STATUS_LABEL[snapshot.status]}, собран{" "}
            {formatMoscowDateTime(snapshot.generatedAt)}
          </p>
        </div>
      </div>

      <section>
        <h2>Неизменяемые реквизиты</h2>
        <dl>
          <dt>Контрольная сумма</dt>
          <dd>{snapshot.checksum}</dd>
          <dt>Исходный прогон</dt>
          <dd>{snapshot.syncRunId}</dd>
          <dt>Версия конфигурации</dt>
          <dd>{snapshot.configId}</dd>
          <dt>Свежесть источника</dt>
          <dd>{formatMoscowDateTime(snapshot.sourceFreshAt)}</dd>
        </dl>
      </section>

      <section>
        <h2>Проверка перед публикацией</h2>
        <p>
          {validation.approved
            ? "Сведение сходится, блокирующих проблем нет."
            : `Не пройдена: ${validation.failures.join(", ")}`}
        </p>
        {openIssues.length === 0 ? (
          <p>Открытых проблем качества нет.</p>
        ) : (
          <ul>
            {openIssues.map(([code, count]) => (
              <li key={code}>
                {code}: {count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Итоги по дням</h2>
        {totals.length === 0 ? (
          <p>В снимке нет строк.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Лиды</th>
                <th scope="col">Заявки</th>
                <th scope="col">Оплаты</th>
                <th scope="col">Выручка</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((cell) => (
                <tr key={cell.reportDate}>
                  <td>{cell.reportDate}</td>
                  <td>{cell.leadsCreated}</td>
                  <td>{cell.applications}</td>
                  <td>{cell.payments}</td>
                  <td>{cell.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}
