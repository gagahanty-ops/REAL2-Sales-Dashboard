import { notFound, redirect } from "next/navigation";

import { getLeadDetail } from "@real2/db";

import { AppShell } from "../../../components/app-shell";
import { qualityLabel } from "../../../components/dashboard/attention-panel";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { CHANNEL_OPTIONS } from "../../../lib/dashboard/filter-url";
import { formatDate, formatRubles } from "../../../lib/dashboard/format";
import { getDatabase } from "../../../lib/server/runtime";
import { formatMoscowDateTime } from "../../../lib/sync-ui";

export const dynamic = "force-dynamic";

function channelLabel(channel: string): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel;
}

/**
 * Read-only lead card (SPEC M5.4): normalized facts, milestones, stage history
 * and the amoCRM link. No raw payload, no custom-field text and no full phone
 * number ever reaches this page.
 */
export default async function LeadPage({
  params,
}: Readonly<{ params: Promise<{ amoLeadId: string }> }>) {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin", "head", "manager"]);
  } catch {
    redirect("/");
  }

  const { amoLeadId } = await params;
  if (!/^[1-9]\d{0,14}$/.test(amoLeadId)) notFound();

  const lead = await getLeadDetail(getDatabase(), Number(amoLeadId), {
    role: user.role,
    amoUserId: user.amoUserId,
  });
  if (!lead) notFound();

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <h1>{lead.displayName}</h1>
          <p>
            Состояние по последнему подтверждённому снимку.{" "}
            <a href={lead.amoUrl} rel="noreferrer noopener" target="_blank">
              Открыть в amoCRM
            </a>
          </p>
        </div>
      </div>

      <section aria-label="Факты сделки">
        <h2>Факты</h2>
        <dl className="conversion-list">
          <dt>Создана</dt>
          <dd>{formatDate(lead.createdDate)}</dd>
          <dt>Текущий этап</dt>
          <dd>{lead.currentStatusName ?? `Статус ${lead.currentStatusId}`}</dd>
          <dt>Ответственный</dt>
          <dd>{lead.currentResponsibleName ?? "Без ответственного"}</dd>
          <dt>Канал</dt>
          <dd>{channelLabel(lead.normalizedChannel)}</dd>
          <dt>Сумма</dt>
          <dd>{formatRubles(lead.priceRub)}</dd>
          <dt>Заявка</dt>
          <dd>{lead.applicationAt ? formatMoscowDateTime(new Date(lead.applicationAt)) : "—"}</dd>
          <dt>Оплата</dt>
          <dd>{lead.wonAt ? formatMoscowDateTime(new Date(lead.wonAt)) : "—"}</dd>
          <dt>Сейчас оплачена</dt>
          <dd>{lead.currentlyWon ? "да" : "нет"}</dd>
        </dl>
      </section>

      <section aria-label="Качество данных">
        <h2>Качество данных</h2>
        {lead.qualityCodes.length === 0 ? (
          <p>Открытых проблем по этой сделке нет.</p>
        ) : (
          <ul className="quality-counters">
            {lead.qualityCodes.map((code) => (
              <li key={code}>{qualityLabel(code)}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="История этапов">
        <h2>История этапов</h2>
        {lead.stageHistory.length === 0 ? (
          <p>
            Событий перехода по этапам нет. Пустая история — это не ноль:
            веха не выводится, пока её не подтвердит событие.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="metric-table">
              <caption>Переходы по этапам в порядке времени</caption>
              <thead>
                <tr>
                  <th scope="col">Когда</th>
                  <th scope="col">Из этапа</th>
                  <th scope="col">В этап</th>
                  <th scope="col">Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {lead.stageHistory.map((entry) => (
                  <tr key={entry.amoEventId}>
                    <th scope="row">
                      {formatMoscowDateTime(new Date(entry.occurredAt))}
                    </th>
                    <td>{entry.fromStatusId ?? "—"}</td>
                    <td>{entry.statusName ?? entry.toStatusId}</td>
                    <td>{entry.responsibleUserId ?? "—"}</td>
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
