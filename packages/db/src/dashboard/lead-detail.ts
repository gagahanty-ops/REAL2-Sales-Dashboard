import { AppError, displayNameFor } from "@real2/domain";

import type { Database } from "../client.js";

export type LeadDetailViewer = Readonly<{
  role: "admin" | "head" | "manager";
  amoUserId: number | null;
}>;

export type LeadStageHistoryEntry = Readonly<{
  amoEventId: string;
  fromStatusId: number | null;
  toStatusId: number;
  statusName: string | null;
  responsibleUserId: number | null;
  occurredAt: string;
}>;

export type LeadDetail = Readonly<{
  amoLeadId: number;
  /** Phone-safe name; the protected stored name never leaves the server. */
  displayName: string;
  createdDate: string;
  currentStatusId: number;
  currentStatusName: string | null;
  currentResponsibleUserId: number | null;
  currentResponsibleName: string | null;
  normalizedChannel: string;
  priceRub: string | null;
  applicationAt: string | null;
  wonAt: string | null;
  currentlyWon: boolean;
  amoUrl: string;
  qualityCodes: readonly string[];
  stageHistory: readonly LeadStageHistoryEntry[];
}>;

type LeadRow = {
  account_id: string;
  amo_lead_id: string;
  name: string;
  created_date: Date;
  current_status_id: string;
  status_name: string | null;
  current_responsible_user_id: string | null;
  responsible_name: string | null;
  normalized_channel: string;
  price_rub: string | null;
  amo_url: string;
  application_at: Date | null;
  won_at: Date | null;
  currently_won: boolean;
  quality_codes: string[];
};

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError("E_DB", 500);
  return parsed;
}

/**
 * Read-only lead card for drill-down. It returns the normalized facts, the
 * milestones, the stage history and the amoCRM link, and never the raw payload,
 * custom-field text or a full phone number (SPEC M5.3, SECURITY_READ_ONLY §7).
 */
export async function getLeadDetail(
  db: Database,
  amoLeadId: number,
  viewer: LeadDetailViewer,
): Promise<LeadDetail | null> {
  if (!Number.isSafeInteger(amoLeadId) || amoLeadId <= 0) {
    throw new AppError("E_VALIDATION", 422);
  }
  if (viewer.role === "manager" && viewer.amoUserId === null) {
    throw new AppError("E_CONFIG_INCOMPLETE", 409);
  }

  const [row] = await db<LeadRow[]>`
    select
      leads.account_id, leads.amo_lead_id, leads.name, leads.created_date,
      leads.current_status_id, statuses.name as status_name,
      leads.current_responsible_user_id, users.name as responsible_name,
      leads.normalized_channel, leads.price_rub, leads.amo_url,
      milestones.application_at, milestones.won_at,
      coalesce(milestones.currently_won, false) as currently_won,
      coalesce(
        array(
          select code from public.data_quality_issues as issues
          where issues.account_id = leads.account_id
            and issues.amo_lead_id = leads.amo_lead_id
            and issues.status = 'open'
          order by code
        ),
        '{}'
      ) as quality_codes
    from public.leads as leads
    left join public.lead_milestones as milestones
      on milestones.account_id = leads.account_id
      and milestones.amo_lead_id = leads.amo_lead_id
    left join public.pipeline_statuses as statuses
      on statuses.account_id = leads.account_id
      and statuses.status_id = leads.current_status_id
    left join public.amo_users as users
      on users.account_id = leads.account_id
      and users.amo_user_id = leads.current_responsible_user_id
    where leads.amo_lead_id = ${amoLeadId} and not leads.is_deleted
  `;
  if (!row) return null;

  const responsibleUserId = row.current_responsible_user_id === null
    ? null
    : safeInteger(row.current_responsible_user_id);
  // A manager may open only their own lead; anybody else's is simply not found.
  if (viewer.role === "manager" && responsibleUserId !== viewer.amoUserId) return null;

  const history = await db<{
    amo_event_id: string;
    from_status_id: string | null;
    to_status_id: string;
    status_name: string | null;
    responsible_user_id: string | null;
    occurred_at: Date;
  }[]>`
    select events.amo_event_id, events.from_status_id, events.to_status_id,
      statuses.name as status_name, events.responsible_user_id, events.occurred_at
    from public.lead_stage_events as events
    left join public.pipeline_statuses as statuses
      on statuses.account_id = events.account_id
      and statuses.status_id = events.to_status_id
    where events.account_id = ${safeInteger(row.account_id)}
      and events.amo_lead_id = ${amoLeadId}
    order by events.occurred_at, events.amo_event_id
  `;

  const leadId = safeInteger(row.amo_lead_id);
  return {
    amoLeadId: leadId,
    displayName: displayNameFor(row.name, leadId),
    createdDate: row.created_date.toISOString().slice(0, 10),
    currentStatusId: safeInteger(row.current_status_id),
    currentStatusName: row.status_name,
    currentResponsibleUserId: responsibleUserId,
    currentResponsibleName: row.responsible_name,
    normalizedChannel: row.normalized_channel,
    priceRub: row.price_rub === null
      ? null
      : row.price_rub.includes(".") ? row.price_rub : `${row.price_rub}.00`,
    applicationAt: row.application_at?.toISOString() ?? null,
    wonAt: row.won_at?.toISOString() ?? null,
    currentlyWon: row.currently_won,
    amoUrl: row.amo_url,
    qualityCodes: row.quality_codes,
    stageHistory: history.map((entry) => ({
      amoEventId: entry.amo_event_id,
      fromStatusId: entry.from_status_id === null ? null : safeInteger(entry.from_status_id),
      toStatusId: safeInteger(entry.to_status_id),
      statusName: entry.status_name,
      responsibleUserId: entry.responsible_user_id === null
        ? null
        : safeInteger(entry.responsible_user_id),
      occurredAt: entry.occurred_at.toISOString(),
    })),
  };
}
