import {
  disableSystemControl,
  finishSheetPublication,
  getActiveSheetTarget,
  getSuccessfulPublication,
  listSheetLayoutMappings,
  raiseAlert,
  startSheetPublication,
  type Database,
  type SheetPublication,
} from "@real2/db";
import {
  AppError,
  buildSheetPayload,
  type ChannelsDailyRow,
  type PlanFactRow,
} from "@real2/domain";
import {
  DEFAULT_RETRY_DELAYS,
  classifyPublicationError,
  createSheetWriteClient,
  publishPayload,
  withPublicationRetries,
  type SheetClientFactory,
} from "@real2/integrations";

export type PublishSheetDeps = Readonly<{
  db: Database;
  factory: SheetClientFactory;
  secrets: Readonly<{
    readGoogleServiceAccount(): Promise<
      Readonly<{ clientEmail: string; privateKey: string }>
    >;
  }>;
  publishEnabledInEnvironment: boolean;
  /** Report rows of the snapshot being published. */
  loadReport(snapshotId: string): Promise<
    Readonly<{ channelsDaily: readonly ChannelsDailyRow[]; planFact: readonly PlanFactRow[] }>
  >;
  traceId: string;
  sleep?: (seconds: number) => Promise<void>;
  now?: () => Date;
}>;

export type PublishSheetResult = Readonly<{
  status: "success" | "skipped";
  publication: SheetPublication;
  snapshotId: string;
  checksum: string;
}>;

async function isPublishEnabledInDatabase(db: Database): Promise<boolean> {
  const [row] = await db<{ enabled: boolean }[]>`
    select enabled from public.system_controls where key = 'sheet_publish_enabled'
  `;
  return row?.enabled === true;
}

/**
 * Publishes one approved snapshot into the active copy. Everything here is
 * fail-closed: without an active target, without both switches, or with a
 * layout that drifted, nothing is written and the previous contents of the
 * copy survive untouched. A snapshot that already published successfully is
 * never written twice.
 */
export async function publishSheet(
  deps: PublishSheetDeps,
  snapshotId: string,
): Promise<PublishSheetResult> {
  const now = deps.now ?? (() => new Date());
  const target = await getActiveSheetTarget(deps.db);
  if (!target || target.layoutFingerprint === null) {
    throw new AppError("E_CONFIG_INCOMPLETE", 409);
  }

  const existing = await getSuccessfulPublication(deps.db, target.id, snapshotId);
  if (existing) {
    // A second invocation for the same snapshot makes no Google request.
    return {
      status: "skipped",
      publication: existing,
      snapshotId,
      checksum: existing.payloadChecksum,
    };
  }

  const mappings = await listSheetLayoutMappings(deps.db, target.id);
  if (mappings.length === 0) throw new AppError("E_CONFIG_INCOMPLETE", 409);

  const report = await deps.loadReport(snapshotId);
  const payload = buildSheetPayload({
    mappings: mappings.map((mapping) => ({
      reportKind: mapping.reportKind,
      logicalField: mapping.logicalField,
      sheetName: mapping.sheetName,
      rangeA1: mapping.rangeA1,
      valueType: mapping.valueType,
      required: mapping.required,
    })),
    channelsDaily: report.channelsDaily,
    planFact: report.planFact,
  });

  const [previous] = await deps.db<{ attempt: number }[]>`
    select attempt from public.sheet_publications
    where target_id = ${target.id} and snapshot_id = ${snapshotId}
    order by attempt desc limit 1
  `;
  const attempt = await startSheetPublication(deps.db, {
    traceId: deps.traceId,
    targetId: target.id,
    snapshotId,
    attempt: (previous?.attempt ?? 0) + 1,
    layoutFingerprint: target.layoutFingerprint,
    payloadChecksum: payload.checksum,
    cellsPlanned: payload.cellCount,
  });

  try {
    // The write client checks both switches itself and reads no credentials
    // while publication is disabled.
    const client = await createSheetWriteClient({
      spreadsheetId: target.spreadsheetId,
      expectedTargetId: target.spreadsheetId,
      secrets: deps.secrets,
      factory: deps.factory,
      publishEnabledInEnvironment: deps.publishEnabledInEnvironment,
      controls: { isPublishEnabled: () => isPublishEnabledInDatabase(deps.db) },
    });

    const outcome = await withPublicationRetries(
      () =>
        publishPayload({
          client,
          payload,
          expectedFingerprint: target.layoutFingerprint as string,
        }),
      {
        delaysSeconds: DEFAULT_RETRY_DELAYS,
        sleep: deps.sleep ?? (async () => undefined),
      },
    );

    const publication = await finishSheetPublication(deps.db, {
      publicationId: attempt.id,
      status: "success",
      cellsWritten: payload.cellCount,
      finishedAt: now(),
    });
    await deps.db`
      update public.system_alerts set status = 'resolved', resolved_at = ${now()}
      where source = 'sheet_publication' and status in ('open', 'acknowledged')
    `;
    return { status: "success", publication, snapshotId, checksum: outcome.checksum };
  } catch (error) {
    const classified = classifyPublicationError(error);
    const blocked = classified.code === "E_SHEET_LAYOUT_MISMATCH"
      || classified.code === "E_SHEET_PROTECTED";
    await finishSheetPublication(deps.db, {
      publicationId: attempt.id,
      status: blocked ? "blocked" : "failed",
      cellsWritten: 0,
      errorCode: classified.code,
      errorSummary: classified.summary,
      finishedAt: now(),
    });
    await raiseAlert(deps.db, {
      traceId: deps.traceId,
      source: "sheet_publication",
      code: classified.code,
      severity: "critical",
      safeSummary: `Публикация снимка не выполнена: ${classified.summary}`,
      safeContext: { snapshotId, attempt: attempt.attempt },
      seenAt: now(),
    });
    // A checksum failure means the copy no longer matches what we sent:
    // automatic publication stays off until a human looks at it.
    if (classified.code === "E_SHEET_UPSTREAM" || blocked) {
      await disableSystemControl(
        deps.db,
        "sheet_publish_enabled",
        `Автоматически отключено: ${classified.code}`,
      );
    }
    throw error;
  }
}
