import { redirect } from "next/navigation";

import { getSystemControl, listSheetPublications } from "@real2/db";

import { AppShell } from "../../components/app-shell";
import { requireRole } from "../../lib/auth/authorization";
import { requireUser } from "../../lib/auth/require-user";
import { getDatabase } from "../../lib/server/runtime";
import { formatMoscowDateTime } from "../../lib/sync-ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  running: "Выполняется",
  success: "Успешно",
  failed: "Ошибка",
  blocked: "Заблокировано",
} as const;

export default async function SheetPublicationsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const [publications, control] = await Promise.all([
    listSheetPublications(db, 50),
    getSystemControl(db, "sheet_publish_enabled"),
  ]);

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>История публикаций</h1>
          <p>
            Каждая попытка сохраняется целиком: контрольная сумма того, что
            отправляли, отпечаток раскладки и код ошибки. Записи неизменяемы.
          </p>
        </div>
      </div>

      <section>
        <h2>Переключатель</h2>
        <p>
          Публикация сейчас{" "}
          <strong>{control?.enabled ? "включена" : "выключена"}</strong>.
          {control?.reason ? ` Причина: ${control.reason}` : ""}
        </p>
      </section>

      <section>
        <h2>Попытки</h2>
        {publications.length === 0 ? (
          <p>Публикаций ещё не было.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Последние попытки публикации</caption>
              <thead>
                <tr>
                  <th scope="col">Начата</th>
                  <th scope="col">Завершена</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Попытка</th>
                  <th scope="col">Ячейки</th>
                  <th scope="col">Контрольная сумма</th>
                  <th scope="col">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((publication) => (
                  <tr key={publication.id}>
                    <th scope="row">{formatMoscowDateTime(publication.startedAt)}</th>
                    <td>
                      {publication.finishedAt
                        ? formatMoscowDateTime(publication.finishedAt)
                        : "—"}
                    </td>
                    <td>{STATUS_LABEL[publication.status]}</td>
                    <td>{publication.attempt}</td>
                    <td>
                      {publication.cellsWritten} из {publication.cellsPlanned}
                    </td>
                    <td>{publication.payloadChecksum.slice(0, 12)}</td>
                    <td>{publication.errorCode ?? "—"}</td>
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
