import { redirect } from "next/navigation";

import {
  getSystemControl,
  listSheetLayoutMappings,
  listSheetPublications,
  listSheetTargets,
} from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { SheetTargetManager } from "../../../components/sheet-target-manager";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { getDatabase } from "../../../lib/server/runtime";
import { formatMoscowDateTime } from "../../../lib/sync-ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  draft: "Черновик",
  validated: "Проверена",
  active: "Активная",
  disabled: "Отключена",
} as const;

const PUBLICATION_LABEL = {
  running: "Выполняется",
  success: "Успешно",
  failed: "Ошибка",
  blocked: "Заблокировано",
} as const;

export default async function GoogleSheetSettingsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head"]);
  } catch {
    redirect("/");
  }

  const db = getDatabase();
  const [targets, publications, control] = await Promise.all([
    listSheetTargets(db),
    listSheetPublications(db, 10),
    getSystemControl(db, "sheet_publish_enabled"),
  ]);
  const active = targets.find((target) => target.status === "active") ?? null;
  const mappings = active ? await listSheetLayoutMappings(db, active.id) : [];

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>Публикация в Google Sheets</h1>
          <p>
            Публикуется только вручную созданная копия. Оригинальная таблица
            защищена константой в коде: её нельзя выбрать ни через настройку, ни
            через запрос, ни через базу.
          </p>
        </div>
      </div>

      <section>
        <h2>Состояние</h2>
        <p>
          Переключатель публикации:{" "}
          <strong>{control?.enabled ? "включён" : "выключен"}</strong>.{" "}
          {control?.enabled
            ? "Публикация выполняется только по расписанию и только в активную копию."
            : "Пока он выключен, ни один запрос в Google невозможен."}
        </p>
      </section>

      {user.role === "admin" ? (
        <section aria-label="Настройка копии">
          <h2>Настройка</h2>
          <p>
            Публикация включается отдельно и вручную: эти действия только
            описывают, куда она пошла бы.
          </p>
          <SheetTargetManager
            targets={targets.map((target) => ({
              id: target.id,
              spreadsheetId: target.spreadsheetId,
              expectedTitle: target.expectedTitle,
              status: target.status,
            }))}
          />
        </section>
      ) : null}

      <section>
        <h2>Копии</h2>
        {targets.length === 0 ? (
          <p>Копия ещё не зарегистрирована.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Зарегистрированные копии таблицы</caption>
              <thead>
                <tr>
                  <th scope="col">Идентификатор</th>
                  <th scope="col">Ожидаемое название</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Отпечаток раскладки</th>
                  <th scope="col">Проверена</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => (
                  <tr key={target.id}>
                    <th scope="row">{target.spreadsheetId}</th>
                    <td>{target.expectedTitle}</td>
                    <td>{STATUS_LABEL[target.status]}</td>
                    <td>{target.layoutFingerprint?.slice(0, 12) ?? "—"}</td>
                    <td>
                      {target.validatedAt
                        ? formatMoscowDateTime(target.validatedAt)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Диапазоны активной копии</h2>
        {mappings.length === 0 ? (
          <p>Для активной копии диапазоны не заданы.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Явные диапазоны: за их пределы публикация не выходит</caption>
              <thead>
                <tr>
                  <th scope="col">Отчёт</th>
                  <th scope="col">Поле</th>
                  <th scope="col">Лист</th>
                  <th scope="col">Диапазон</th>
                  <th scope="col">Тип</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id}>
                    <th scope="row">{mapping.reportKind}</th>
                    <td>{mapping.logicalField}</td>
                    <td>{mapping.sheetName}</td>
                    <td>{mapping.rangeA1}</td>
                    <td>{mapping.valueType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Последние попытки публикации</h2>
        {publications.length === 0 ? (
          <p>Публикаций ещё не было.</p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>История публикаций с контрольными суммами</caption>
              <thead>
                <tr>
                  <th scope="col">Начата</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Попытка</th>
                  <th scope="col">Ячейки</th>
                  <th scope="col">Код ошибки</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((publication) => (
                  <tr key={publication.id}>
                    <th scope="row">{formatMoscowDateTime(publication.startedAt)}</th>
                    <td>{PUBLICATION_LABEL[publication.status]}</td>
                    <td>{publication.attempt}</td>
                    <td>
                      {publication.cellsWritten} из {publication.cellsPlanned}
                    </td>
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
