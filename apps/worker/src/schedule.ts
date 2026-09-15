import type { SyncKind } from "@real2/db";

const FIVE_MINUTES_MS = 5 * 60_000;
const MOSCOW_OFFSET_MS = 3 * 60 * 60_000;

function fiveMinuteSlot(value: Date): number {
  return Math.floor(value.getTime() / FIVE_MINUTES_MS);
}

function moscowParts(value: Date): { date: string; hour: number; minute: number } {
  const shifted = new Date(value.getTime() + MOSCOW_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function dueSyncKinds(
  now: Date,
  lastDispatchAt: Date | null,
): readonly Extract<SyncKind, "incremental" | "nightly_reconciliation">[] {
  const due: Extract<SyncKind, "incremental" | "nightly_reconciliation">[] = [];
  if (
    now.getUTCMinutes() % 5 === 0 &&
    (!lastDispatchAt || fiveMinuteSlot(lastDispatchAt) < fiveMinuteSlot(now))
  ) {
    due.push("incremental");
  }

  const moscowNow = moscowParts(now);
  const moscowPrevious = lastDispatchAt ? moscowParts(lastDispatchAt) : null;
  if (
    moscowNow.hour === 2 &&
    moscowNow.minute === 30 &&
    (!moscowPrevious ||
      moscowPrevious.date !== moscowNow.date ||
      moscowPrevious.hour < 2 ||
      (moscowPrevious.hour === 2 && moscowPrevious.minute < 30))
  ) {
    due.push("nightly_reconciliation");
  }
  return due;
}

export async function dispatchDueSyncs(
  input: Readonly<{
    now: Date;
    lastDispatchAt: Date | null;
    run(kind: Extract<SyncKind, "incremental" | "nightly_reconciliation">): Promise<void>;
  }>,
): Promise<readonly SyncKind[]> {
  const due = dueSyncKinds(input.now, input.lastDispatchAt);
  for (const kind of due) await input.run(kind);
  return due;
}
