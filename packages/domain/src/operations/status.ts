export type HealthAlert = Readonly<{
  code: string;
  severity: "info" | "warning" | "critical";
  summary: string;
}>;

export type SystemHealthInput = Readonly<{
  now: Date;
  databaseReachable: boolean;
  activeConfig: boolean;
  currentSnapshot: Readonly<{ version: number; sourceFreshAt: Date }> | null;
  lastSuccessfulSyncAt: Date | null;
  consecutiveSyncFailures: number;
  openBlockingQualityIssues: number;
  /** Newest publication attempt, if publication is configured at all. */
  lastPublication: Readonly<{ status: string; errorCode: string | null }> | null;
  amoTokenExpiresAt: Date | null;
}>;

export type SystemHealth = Readonly<{
  dashboard: Readonly<{
    available: boolean;
    snapshotVersion: number | null;
    stale: boolean;
  }>;
  readiness: Readonly<{
    ready: boolean;
    checks: Readonly<{
      database: boolean;
      activeConfig: boolean;
      currentSnapshot: boolean;
    }>;
  }>;
  alerts: readonly HealthAlert[];
}>;

const STALE_AFTER_MS = 10 * 60_000;
const CONSECUTIVE_FAILURE_LIMIT = 5;
const TOKEN_EXPIRY_WARNING_MS = 24 * 60 * 60_000;

/**
 * One safe judgement about the system. It never invents data and never hides a
 * problem: a failing source leaves the last approved snapshot in place and
 * marks it stale, which is the honest answer to "are these numbers current?".
 */
export function evaluateSystemHealth(input: SystemHealthInput): SystemHealth {
  const alerts: HealthAlert[] = [];
  const freshnessAge = input.lastSuccessfulSyncAt === null
    ? Number.POSITIVE_INFINITY
    : input.now.getTime() - input.lastSuccessfulSyncAt.getTime();
  const stale = freshnessAge > STALE_AFTER_MS;

  if (!input.databaseReachable) {
    alerts.push({
      code: "database_unreachable",
      severity: "critical",
      summary: "База данных недоступна",
    });
  }
  if (input.currentSnapshot === null) {
    alerts.push({
      code: "snapshot_missing",
      severity: "critical",
      summary: "Утверждённого снимка нет: отчёт показывать нечего",
    });
  } else if (stale) {
    alerts.push({
      code: "sync_stale",
      severity: "warning",
      summary: "Синхронизация отстаёт больше десяти минут",
    });
  }
  if (input.consecutiveSyncFailures >= CONSECUTIVE_FAILURE_LIMIT) {
    alerts.push({
      code: "sync_failing",
      severity: "critical",
      summary: "Пять синхронизаций подряд завершились ошибкой",
    });
  }
  if (input.openBlockingQualityIssues > 0) {
    alerts.push({
      code: "quality_blocking",
      severity: "warning",
      summary: "Есть непринятые блокирующие проблемы качества",
    });
  }
  if (!input.activeConfig) {
    alerts.push({
      code: "configuration_incomplete",
      severity: "critical",
      summary: "Активная конфигурация воронки не выбрана",
    });
  }
  if (
    input.amoTokenExpiresAt !== null
    && input.amoTokenExpiresAt.getTime() - input.now.getTime() < TOKEN_EXPIRY_WARNING_MS
  ) {
    alerts.push({
      code: "amo_token_expiring",
      severity: "warning",
      summary: "Токен amoCRM истекает меньше чем через сутки",
    });
  }
  if (input.lastPublication?.status === "blocked") {
    alerts.push({
      code: "sheet_layout_drift",
      severity: "critical",
      summary: "Публикация заблокирована: раскладка копии изменилась",
    });
  }
  if (
    input.lastPublication?.status === "failed"
    && input.lastPublication.errorCode === "E_SHEET_UPSTREAM"
  ) {
    alerts.push({
      code: "sheet_checksum_mismatch",
      severity: "critical",
      summary: "Публикация не сошлась по контрольной сумме",
    });
  }

  return {
    dashboard: {
      // The dashboard stays available on a stale snapshot: an old number with
      // an honest timestamp is more useful than an empty screen.
      available: input.currentSnapshot !== null && input.databaseReachable,
      snapshotVersion: input.currentSnapshot?.version ?? null,
      stale,
    },
    readiness: {
      ready:
        input.databaseReachable && input.activeConfig && input.currentSnapshot !== null,
      checks: {
        database: input.databaseReachable,
        activeConfig: input.activeConfig,
        currentSnapshot: input.currentSnapshot !== null,
      },
    },
    alerts,
  };
}
