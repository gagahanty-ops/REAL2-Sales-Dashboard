import React from "react";

import { formatMoscowDateTime } from "../../lib/sync-ui";

export type FreshnessBannerProps = Readonly<{
  snapshotVersion: number;
  generatedAt: Date;
  sourceFreshAt: Date;
  stale: boolean;
}>;

/**
 * Says which immutable snapshot the numbers come from and how fresh the source
 * was, so a reader can tell "no sales today" from "no data today".
 */
export function FreshnessBanner({
  snapshotVersion,
  generatedAt,
  sourceFreshAt,
  stale,
}: FreshnessBannerProps) {
  return (
    <div className={stale ? "freshness freshness-stale" : "freshness"} role="status">
      <span>
        Снимок №{snapshotVersion} от {formatMoscowDateTime(generatedAt)}
      </span>
      <span>Данные источника на {formatMoscowDateTime(sourceFreshAt)}</span>
      {stale ? <strong>Синхронизация отстаёт больше 10 минут</strong> : null}
    </div>
  );
}
