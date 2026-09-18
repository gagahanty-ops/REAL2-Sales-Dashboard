import { toMoscowDate, unixSecondsToInstant, type MetricLeadFact } from "@real2/domain";

/**
 * The golden dataset of METRICS_CATALOG section 13. Every value is fictional.
 * The scenarios are numbered as in the catalogue, and the Moscow-midnight pair
 * derives its calendar day through `toMoscowDate` so the boundary is proven,
 * not hard-coded.
 */

const MANAGER_ONE = 7;
const MANAGER_TWO = 8;
const MANAGER_THREE = 9;

function moscowDay(iso: string): string {
  const day = toMoscowDate(iso);
  if (day === null) throw new Error(`golden fixture has an unusable instant: ${iso}`);
  return day;
}

function moscowDayOfUnix(seconds: number): string {
  const instant = unixSecondsToInstant(seconds);
  if (instant === null) throw new Error("golden fixture has an unusable timestamp");
  return moscowDay(instant);
}

/** 2026-09-08T20:59:59Z is 23:59:59 in Moscow; one second later is the next day. */
const BEFORE_MOSCOW_MIDNIGHT = Date.UTC(2026, 8, 8, 20, 59, 59) / 1_000;
const AFTER_MOSCOW_MIDNIGHT = Date.UTC(2026, 8, 8, 21, 0, 0) / 1_000;

export const GOLDEN_RANGE = { from: "2026-09-01", to: "2026-09-30" } as const;
export const GOLDEN_DAILY_RANGE = { from: "2026-09-05", to: "2026-09-09" } as const;

export const goldenLeadFacts: readonly MetricLeadFact[] = [
  // 1. Created and still open.
  {
    amoLeadId: 1001,
    createdDate: "2026-09-05",
    applicationAt: null,
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "site",
    managerId: MANAGER_ONE,
  },
  // 2. Created one day, application the next.
  {
    amoLeadId: 1002,
    createdDate: "2026-09-05",
    applicationAt: "2026-09-06T06:00:00.000Z",
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "avito",
    managerId: MANAGER_ONE,
  },
  // 3. Created in one month, paid in the next: the cohort stays in September.
  {
    amoLeadId: 1003,
    createdDate: "2026-09-28",
    applicationAt: "2026-09-29T07:00:00.000Z",
    wonAt: "2026-10-02T07:00:00.000Z",
    currentlyWon: true,
    priceRub: "50000.00",
    channel: "phone_uis",
    managerId: MANAGER_TWO,
  },
  // 4. Re-entered the application stage; only the first entry counts.
  {
    amoLeadId: 1004,
    createdDate: "2026-09-06",
    applicationAt: "2026-09-07T08:00:00.000Z",
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "telegram",
    managerId: MANAGER_ONE,
  },
  // 5. Won and then returned to an open status: history stays, payment drops.
  {
    amoLeadId: 1005,
    createdDate: "2026-09-06",
    applicationAt: "2026-09-07T08:00:00.000Z",
    wonAt: "2026-09-08T08:00:00.000Z",
    currentlyWon: false,
    priceRub: "30000.00",
    channel: "whatsapp",
    managerId: MANAGER_TWO,
  },
  // 6. Responsible changed; the report uses the current one.
  {
    amoLeadId: 1006,
    createdDate: "2026-09-07",
    applicationAt: "2026-09-08T08:00:00.000Z",
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "instagram",
    managerId: MANAGER_THREE,
  },
  // 7. Unknown channel still counts in the totals.
  {
    amoLeadId: 1007,
    createdDate: "2026-09-07",
    applicationAt: null,
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "unknown",
    managerId: MANAGER_ONE,
  },
  // 8. Won without a valid price: a payment that adds nothing to revenue.
  {
    amoLeadId: 1008,
    createdDate: "2026-09-07",
    applicationAt: "2026-09-08T08:00:00.000Z",
    wonAt: "2026-09-09T08:00:00.000Z",
    currentlyWon: true,
    priceRub: null,
    channel: "max",
    managerId: MANAGER_THREE,
  },
  // 9. The same observation received twice must not double any total.
  {
    amoLeadId: 1009,
    createdDate: "2026-09-08",
    applicationAt: "2026-09-09T08:00:00.000Z",
    wonAt: "2026-09-10T08:00:00.000Z",
    currentlyWon: true,
    priceRub: "1000.55",
    channel: "site",
    managerId: MANAGER_ONE,
  },
  {
    amoLeadId: 1009,
    createdDate: "2026-09-08",
    applicationAt: "2026-09-09T08:00:00.000Z",
    wonAt: "2026-09-10T08:00:00.000Z",
    currentlyWon: true,
    priceRub: "1000.55",
    channel: "site",
    managerId: MANAGER_ONE,
  },
  // 10. Created around Moscow midnight, one second apart.
  {
    amoLeadId: 1010,
    createdDate: moscowDayOfUnix(BEFORE_MOSCOW_MIDNIGHT),
    applicationAt: null,
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "site",
    managerId: MANAGER_TWO,
  },
  {
    amoLeadId: 1011,
    createdDate: moscowDayOfUnix(AFTER_MOSCOW_MIDNIGHT),
    applicationAt: null,
    wonAt: null,
    currentlyWon: false,
    priceRub: null,
    channel: "site",
    managerId: MANAGER_TWO,
  },
];
