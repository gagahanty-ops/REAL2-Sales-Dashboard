import { z } from "zod";

import { normalizedChannelSchema } from "../amo/config.js";
import { AppError } from "../errors.js";
import type { NormalizedChannel } from "../leads/channel.js";
import { dateRangeLength, isDateInRange } from "../metrics/periods.js";

export type DashboardFilters = Readonly<{
  /** Inclusive Moscow creation-date interval. */
  from: string;
  to: string;
  channels: readonly NormalizedChannel[];
  managerIds: readonly number[];
  /** `manager=unassigned`: leads with no responsible. */
  includeUnassigned: boolean;
  /** No manager filter at all, which is the department view. */
  allManagers: boolean;
  /** `compare=previous` (default) or `compare=none`. */
  compare: boolean;
}>;

export type ParseDashboardFiltersOptions = Readonly<{
  /** Today's Moscow date; used only when no interval is requested. */
  today: string;
}>;

const MAX_RANGE_DAYS = 366;
const MAX_CHANNELS = 8;
const MAX_MANAGERS = 100;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const managerParamSchema = z.union([
  z.literal("all"),
  z.literal("unassigned"),
  z.string().regex(/^amo:[1-9]\d{0,14}$/),
]);

function invalid(): never {
  throw new AppError("E_VALIDATION", 422);
}

function assertRealDate(value: string): string {
  if (!isoDateSchema.safeParse(value).success) invalid();
  // `isDateInRange` rejects impossible calendar days such as 2026-02-30.
  try {
    isDateInRange(value, { from: value, to: value });
  } catch {
    invalid();
  }
  return value;
}

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Parses the untrusted dashboard query of SPEC M7.3. Unknown parameters are
 * ignored, every known one is validated, and nothing is silently repaired: a
 * half-filled interval or an unknown channel is a validation error, never a
 * quietly different report.
 */
export function parseDashboardFilters(
  params: URLSearchParams,
  options: ParseDashboardFiltersOptions,
): DashboardFilters {
  const today = assertRealDate(options.today);
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  if ((rawFrom === null) !== (rawTo === null)) invalid();

  const from = rawFrom === null ? monthStart(today) : assertRealDate(rawFrom);
  const to = rawTo === null ? today : assertRealDate(rawTo);
  if (from > to) invalid();
  if (dateRangeLength({ from, to }) > MAX_RANGE_DAYS) invalid();

  const channelValues = params.getAll("channel");
  const channels = [
    ...new Set(
      channelValues
        .filter((value) => value !== "all")
        .map((value) => {
          const parsed = normalizedChannelSchema.safeParse(value);
          return parsed.success ? (parsed.data as NormalizedChannel) : invalid();
        }),
    ),
  ].sort();
  if (channels.length > MAX_CHANNELS) invalid();

  const managerValues = params.getAll("manager").map((value) => {
    const parsed = managerParamSchema.safeParse(value);
    return parsed.success ? parsed.data : invalid();
  });
  const managerIds = [
    ...new Set(
      managerValues
        .filter((value) => value.startsWith("amo:"))
        .map((value) => Number(value.slice("amo:".length))),
    ),
  ].sort((left, right) => left - right);
  if (managerIds.length > MAX_MANAGERS) invalid();
  const includeUnassigned = managerValues.includes("unassigned");
  const allManagers = managerIds.length === 0 && !includeUnassigned;

  const rawCompare = params.get("compare");
  if (rawCompare !== null && rawCompare !== "previous" && rawCompare !== "none") invalid();

  return {
    from,
    to,
    channels,
    managerIds,
    includeUnassigned,
    allManagers,
    compare: rawCompare !== "none",
  };
}
