import { AppError } from "@real2/domain";

import type { Database } from "./client.js";

export type PlanMetricKey = "leads_created" | "applications" | "payments" | "revenue";

export type SalesPlan = Readonly<{
  id: string;
  month: string;
  managerKey: string;
  metricKey: PlanMetricKey;
  targetValue: string;
  version: number;
  validFrom: Date;
  validTo: Date | null;
  createdBy: string;
}>;

export type SetSalesPlanInput = Readonly<{
  month: string;
  /** `all` for the department, otherwise the amoCRM user id as text. */
  managerKey: string;
  metricKey: PlanMetricKey;
  targetValue: string;
  actorId: string;
  now?: Date;
}>;

type PlanRow = {
  id: string;
  month: Date;
  manager_key: string;
  metric_key: PlanMetricKey;
  target_value: string;
  version: number;
  valid_from: Date;
  valid_to: Date | null;
  created_by: string;
};

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;
const POSITIVE_MONEY = /^(0|[1-9]\d{0,11})\.\d{2}$/;
const MANAGER_KEY = /^(all|unassigned|[1-9]\d{0,14})$/;
const METRIC_KEYS: readonly PlanMetricKey[] = [
  "leads_created",
  "applications",
  "payments",
  "revenue",
];

function mapPlan(row: PlanRow): SalesPlan {
  return {
    id: row.id,
    month: row.month.toISOString().slice(0, 10),
    managerKey: row.manager_key,
    metricKey: row.metric_key,
    targetValue: row.target_value,
    version: row.version,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdBy: row.created_by,
  };
}

function validateInput(input: SetSalesPlanInput): void {
  if (
    !FIRST_OF_MONTH.test(input.month)
    || !MANAGER_KEY.test(input.managerKey)
    || !METRIC_KEYS.includes(input.metricKey)
    || !POSITIVE_MONEY.test(input.targetValue)
    || input.targetValue === "0.00"
  ) {
    throw new AppError("E_VALIDATION", 422);
  }
}

/**
 * Sets the current target by closing the previous row and inserting the next
 * version. Plan history is never overwritten (SPEC M6.5).
 */
export async function setSalesPlanTarget(
  db: Database,
  input: SetSalesPlanInput,
): Promise<SalesPlan> {
  validateInput(input);
  const now = input.now ?? new Date();
  return db.begin(async (transaction) => {
    const [previous] = await transaction<{ version: number }[]>`
      select version from public.sales_plans
      where month = ${input.month}
        and manager_key = ${input.managerKey}
        and metric_key = ${input.metricKey}
      order by version desc
      limit 1
      for update
    `;
    await transaction`
      update public.sales_plans set valid_to = ${now}
      where month = ${input.month}
        and manager_key = ${input.managerKey}
        and metric_key = ${input.metricKey}
        and valid_to is null
    `;
    const [row] = await transaction<PlanRow[]>`
      insert into public.sales_plans (
        month, manager_key, metric_key, target_value, version, valid_from, created_by
      ) values (
        ${input.month}, ${input.managerKey}, ${input.metricKey}, ${input.targetValue},
        ${(previous?.version ?? 0) + 1}, ${now}, ${input.actorId}
      )
      returning id, month, manager_key, metric_key, target_value, version,
        valid_from, valid_to, created_by
    `;
    if (!row) throw new AppError("E_DB", 500);
    return mapPlan(row);
  });
}

export async function listSalesPlans(
  db: Database,
  filter: Readonly<{ month?: string | undefined; currentOnly?: boolean | undefined }> = {},
): Promise<readonly SalesPlan[]> {
  if (filter.month !== undefined && !FIRST_OF_MONTH.test(filter.month)) {
    throw new AppError("E_VALIDATION", 422);
  }
  const rows = await db<PlanRow[]>`
    select id, month, manager_key, metric_key, target_value, version,
      valid_from, valid_to, created_by
    from public.sales_plans
    where (${filter.month ?? null}::date is null or month = ${filter.month ?? null})
      and (${filter.currentOnly ?? false}::boolean is false or valid_to is null)
    order by month desc, manager_key, metric_key, version desc
  `;
  return rows.map(mapPlan);
}

/** The target in force for a month, or `null` when no plan exists. */
export async function getCurrentSalesPlan(
  db: Database,
  month: string,
  managerKey: string,
  metricKey: PlanMetricKey,
): Promise<SalesPlan | null> {
  if (!FIRST_OF_MONTH.test(month) || !MANAGER_KEY.test(managerKey)) {
    throw new AppError("E_VALIDATION", 422);
  }
  const [row] = await db<PlanRow[]>`
    select id, month, manager_key, metric_key, target_value, version,
      valid_from, valid_to, created_by
    from public.sales_plans
    where month = ${month} and manager_key = ${managerKey}
      and metric_key = ${metricKey} and valid_to is null
  `;
  return row ? mapPlan(row) : null;
}
